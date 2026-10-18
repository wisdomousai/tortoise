import {
  ApplicationError,
  type InputOf,
  type OutputOf,
  type JsonValue,
} from '@agent-native/contracts';
import type { HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import {
  FIELDS,
  MES,
  hmiTarget,
  own,
  put,
  usable,
  type LineState,
  type CountReport,
} from '../domain';
import { stationOf } from '../server/access';
import { compact, now, newId, handler, type Context, type LineServices } from '../server/context';
import { stopDto, countDto, desiredDto } from '../server/dto';

/** Record the desired recipe and queue its screen procedure; the station shows the result later. */
function startOrder(
  input: InputOf<typeof operations.orderStart>,
  ctx: Context,
): OutputOf<typeof operations.orderStart> {
  const station = stationOf(ctx.state, input.station);
  const order = own(ctx.state.orders, input.orderId);
  if (!order || order.station !== station.id)
    throw new ApplicationError('NOT_FOUND', 'Order unavailable at this station', {
      field: 'orderId',
    });
  if (order.status !== 'released')
    throw new ApplicationError('CONFLICT', `Order is ${order.status}`, { field: 'orderId' });
  // One screen procedure at a time; a held one must be reconciled first.
  if (station.desired?.sync === 'pending')
    throw new ApplicationError('CONFLICT', 'A recipe load is already in progress at this station');
  const machine = own(station.readings, FIELDS.machine);
  // A fail-fast check on what we observed; the bridge checks the screen itself before acting.
  if (usable(machine, now(ctx)) && machine.value !== 'STOPPED')
    throw new ApplicationError('CONFLICT', `Machine is ${String(machine.value)}; stop it first`);
  const requestedAt = now(ctx);
  const effectId = ctx.enqueue({
    target: hmiTarget(station.id),
    type: 'recipe.load',
    resource: `station:${station.id}`,
    payload: {
      recipe: order.recipe,
      order: order.id,
      // Instance-derived: this command is person-only, so the caller is at the station.
      presence: { confirmedBy: ctx.context.principalId },
    } as JsonValue,
  });
  station.desired = {
    recipe: order.recipe,
    orderId: order.id,
    requestedBy: ctx.context.principalId,
    requestedAt,
    effectId,
    sync: 'pending',
  };
  ctx.change(`station:${station.id}`);
  return {
    station: station.id,
    revision: ctx.getRevision(`station:${station.id}`) + 1,
    desired: desiredDto(ctx, station)!,
  };
}

/** Classify a stop and queue it for the MES; a rejected classification can be classified again. */
function classifyStop(
  input: InputOf<typeof operations.stopClassify>,
  ctx: Context,
): OutputOf<typeof operations.stopClassify> {
  const stop = own(ctx.state.stops, input.stopId);
  if (!stop) throw new ApplicationError('NOT_FOUND', 'Stop unavailable');
  if (stop.sync === 'pending' || stop.sync === 'accepted')
    throw new ApplicationError('CONFLICT', 'Stop is already classified', { field: 'stopId' });
  const reason = own(ctx.state.reasons, input.reason);
  if (!reason)
    throw new ApplicationError('INVALID_INPUT', 'Unknown stop reason', { field: 'reason' });
  stop.reason = reason.code;
  stop.classifiedBy = ctx.context.principalId;
  stop.classifiedAt = now(ctx);
  stop.sync = 'pending';
  delete stop.rejection;
  stop.effectId = ctx.enqueue({
    target: MES,
    type: 'stop.post',
    resource: `stop:${stop.id}`,
    payload: compact({
      station: stop.station,
      order: stop.orderId,
      state: stop.state,
      alarm: stop.alarm,
      startedAt: stop.startedAt,
      endedAt: stop.endedAt,
      reason: reason.code,
      classifiedBy: stop.classifiedBy,
    }) as JsonValue,
  });
  ctx.change(`stop:${stop.id}`);
  return stopDto(ctx, stop, true);
}

/** Forward the confirmed counters for the active order to the MES; never a guess. */
function confirmCounts(
  input: InputOf<typeof operations.countConfirm>,
  ctx: Context,
): OutputOf<typeof operations.countConfirm> {
  const station = stationOf(ctx.state, input.station);
  const order = station.orderId ? own(ctx.state.orders, station.orderId) : undefined;
  if (!order || order.status !== 'active')
    throw new ApplicationError('CONFLICT', 'No active order at this station');
  const at = now(ctx);
  const good = own(station.readings, FIELDS.good);
  const scrap = own(station.readings, FIELDS.scrap);
  // Only confident or person-verified, fresh values become MES records; never a guess.
  if (
    !usable(good, at) ||
    !usable(scrap, at) ||
    typeof good.value !== 'number' ||
    typeof scrap.value !== 'number'
  )
    throw new ApplicationError(
      'CONFLICT',
      'Counters are not confirmed; check them at the station',
      {
        field: 'counters',
      },
    );
  const id = newId(ctx);
  const report: CountReport = {
    id,
    station: station.id,
    orderId: order.id,
    good: good.value,
    scrap: scrap.value,
    observedAt: Math.min(good.observedAt, scrap.observedAt),
    provenance:
      good.status === 'observed' && scrap.status === 'observed' ? 'observed' : 'operator-verified',
    confirmedBy: ctx.context.principalId,
    confirmedAt: at,
    sync: 'pending',
    effectId: ctx.enqueue({
      target: MES,
      type: 'count.post',
      resource: `count:${id}`,
      payload: {
        order: order.id,
        station: station.id,
        good: good.value,
        scrap: scrap.value,
        observedAt: Math.min(good.observedAt, scrap.observedAt),
      },
    }),
  };
  put(ctx.state.counts, id, report);
  ctx.change(`count:${id}`);
  return countDto(report);
}

/** Order start, stop classification and count confirmation. */
export function productionHandlers(): HandlerContribution<LineState, LineServices>[] {
  return [
    handler(operations.orderStart, startOrder),
    handler(operations.stopClassify, classifyStop),
    handler(operations.countConfirm, confirmCounts),
  ];
}

import type { InputOf, OutputOf } from '@tortoise/contracts';
import type { HandlerContribution, Effect } from '@tortoise/runtime';
import { operations } from '../contracts';
import { MES, hmiTarget, openStop, own, type LineState } from '../domain';
import { stationOfResource } from '../policy';
import { stationOf, accessibleStations, isStale, counters } from '../server/access';
import { attentionItems } from '../server/attention';
import { compact, byCodePoint, handler, type Context, type LineServices } from '../server/context';
import { readingDto, stopDto, desiredDto, summary } from '../server/dto';

/** One station with its readings, order, desired recipe, open stop and bridge state. */
function stationDetail(
  input: InputOf<typeof operations.stationGet>,
  ctx: Context,
): OutputOf<typeof operations.stationGet> {
  const station = stationOf(ctx.state, input.station);
  const stop = openStop(ctx.state, station.id);
  const order = station.orderId ? own(ctx.state.orders, station.orderId) : undefined;
  return compact({
    ...summary(ctx, station),
    countersRevision: ctx.getRevision(counters(station.id)),
    bridge: compact({
      mode: station.mode,
      controlledBy: station.controlledBy,
      controlChangedBy: station.controlChangedBy,
      controlChangedAt: station.controlChangedAt,
      screen: station.screen,
      observedAt: station.observedAt,
      profile: station.profile,
      localInputAt: station.localInputAt,
      stale: isStale(ctx, station),
    }),
    readings: Object.fromEntries(
      Object.entries(station.readings).map(([field, reading]) => [field, readingDto(ctx, reading)]),
    ),
    order: order ? { ...order } : undefined,
    desired: desiredDto(ctx, station),
    currentStop: stop ? stopDto(ctx, stop) : undefined,
  });
}

/** Stops at a station, newest first, filtered before paging. */
function listStops(
  input: InputOf<typeof operations.stopList>,
  ctx: Context,
): OutputOf<typeof operations.stopList> {
  stationOf(ctx.state, input.station);
  const items = Object.values(ctx.state.stops)
    .filter(
      (stop) =>
        stop.station === input.station &&
        (!input.unclassified || stop.reason === undefined || stop.sync === 'rejected'),
    )
    .sort((a, b) => b.startedAt - a.startedAt || byCodePoint(a.id, b.id));
  const offset = input.offset ?? 0;
  return {
    count: items.length,
    items: items.slice(offset, offset + (input.limit ?? 50)).map((stop) => stopDto(ctx, stop)),
  };
}

/** Outbox counts per target and recent rejections, for the stations the caller can see. */
export function syncStatus(ctx: Context) {
  const stations = accessibleStations(ctx);
  const visible = new Set(stations.map((station) => station.id));
  const inScope = (effect: Effect) => {
    const station = stationOfResource(ctx.state, effect.resource);
    return station !== undefined && visible.has(station);
  };
  const targets = [MES, ...stations.map((station) => hmiTarget(station.id))].map((target) => {
    const effects = ctx.effects({ target }).filter(inScope);
    const pending = effects.filter((effect) => effect.status === 'pending');
    return {
      target,
      pending: pending.filter((effect) => effect.heldAt === undefined).length,
      held: pending.filter((effect) => effect.heldAt !== undefined).length,
      retrying: pending.filter((effect) => effect.heldAt === undefined && effect.attempts > 0)
        .length,
      accepted: effects.filter((effect) => effect.status === 'accepted').length,
      rejected: effects.filter((effect) => effect.status === 'rejected').length,
    };
  });
  const rejections = ctx
    .effects({ status: 'rejected' })
    .filter(inScope)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .slice(0, 20)
    .flatMap((effect) =>
      effect.outcome?.status === 'rejected'
        ? [
            {
              resource: effect.resource,
              station: stationOfResource(ctx.state, effect.resource)!,
              code: effect.outcome.code,
              message: effect.outcome.message,
            },
          ]
        : [],
    );
  // The MES integration sees no station, so it reads only its watermark here.
  return { targets: visible.size ? targets : [], rejections };
}

/** Station, stop, order and reason reads. */
export function queryHandlers(): HandlerContribution<LineState, LineServices>[] {
  return [
    handler(operations.stationList, (_, ctx) => ({
      items: accessibleStations(ctx).map((station) => summary(ctx, station)),
    })),
    handler(operations.stationGet, stationDetail),
    handler(operations.stopList, listStops),
    handler(operations.attentionList, (input, ctx) => ({
      items: attentionItems(ctx, stationOf(ctx.state, input.station)),
    })),
    handler(operations.reasonList, (_, ctx) => ({
      items: accessibleStations(ctx).length
        ? Object.values(ctx.state.reasons).sort((a, b) => byCodePoint(a.code, b.code))
        : [],
    })),
    handler(operations.orderList, (input, ctx) => ({
      items: Object.values(ctx.state.orders)
        .filter((order) => order.station === input.station && order.status !== 'completed')
        .sort(
          (a, b) =>
            Number(b.status === 'active') - Number(a.status === 'active') ||
            byCodePoint(a.id, b.id),
        )
        .map((order) => ({ ...order })),
    })),
    handler(operations.controlGet, (input, ctx) => {
      const station = stationOf(ctx.state, input.station);
      return { mode: station.mode, controlledBy: station.controlledBy };
    }),
  ];
}

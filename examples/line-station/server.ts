import { randomUUID } from 'node:crypto';
import {
  ApplicationError,
  type AnyCapability,
  type InputOf,
  type JsonValue,
  type OutputOf,
} from '@agent-native/contracts';
import type {
  Effect,
  EffectOutcome,
  HandlerContext,
  HandlerContribution,
} from '@agent-native/runtime';
import { operations } from './contracts';
import {
  FIELDS,
  FRESH_MS,
  MES,
  bridgeStation,
  hmiTarget,
  openAttention,
  openStop,
  own,
  put,
  stationRole,
  usable,
  type AttentionItem,
  type CountReport,
  type LineState,
  type Reading,
  type Station,
  type Stop,
  type Synchronized,
} from './domain';
import { stationOfResource } from './policy';

export interface LineServices {
  newId?: () => string;
  /** Authority clock for freshness, stops and confirmations. */
  now?: () => number;
}
type Context = HandlerContext<LineState, LineServices>;

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** JSON state and DTOs never hold `undefined`; optional members are omitted. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
const now = (ctx: Context) => (ctx.services.now ?? Date.now)();
const newId = (ctx: Context) => (ctx.services.newId ?? randomUUID)();
function stationOf(state: LineState, id: string): Station {
  const station = own(state.stations, id);
  if (!station) throw new ApplicationError('NOT_FOUND', 'Station unavailable');
  return station;
}
function accessibleStations(ctx: Context): Station[] {
  return Object.values(ctx.state.stations)
    .filter(
      (station) =>
        stationRole(ctx.state, ctx.context.principalId, station.id) &&
        (!ctx.context.grant?.resources ||
          ctx.context.grant.resources.includes(`station:${station.id}`)),
    )
    .sort((a, b) => byCodePoint(a.id, b.id));
}
const isStale = (ctx: Context, station: Station) =>
  station.observedAt === undefined || now(ctx) - station.observedAt > FRESH_MS;
const counters = (station: string) => `counters:${station}`;

const readingDto = (ctx: Context, reading: Reading) =>
  compact({ ...reading, stale: now(ctx) - reading.observedAt > FRESH_MS });
const stopDto = (ctx: Context, stop: Stop, changed = false) => {
  const { effectId: _effectId, ...rest } = stop;
  return compact({ ...rest, revision: ctx.getRevision(`stop:${stop.id}`) + Number(changed) });
};
const countDto = ({ effectId: _effectId, ...count }: CountReport) => count;
function heldEffect(ctx: Context, effectId: string | undefined): Effect | undefined {
  return effectId
    ? ctx.effects({ held: true }).find((effect) => effect.id === effectId)
    : undefined;
}
function desiredDto(ctx: Context, station: Station) {
  const desired = station.desired;
  if (!desired) return undefined;
  const { effectId, sorRef: _sorRef, ...rest } = desired;
  const held = heldEffect(ctx, effectId);
  const recipe = own(station.readings, FIELDS.recipe);
  return compact({
    ...rest,
    sync: held ? ('held' as const) : desired.sync,
    holdReason: held?.holdReason,
    converged: usable(recipe, now(ctx)) && recipe.value === desired.recipe,
  });
}
function summary(ctx: Context, station: Station, changed = false) {
  return compact({
    id: station.id,
    revision: ctx.getRevision(`station:${station.id}`) + Number(changed),
    name: station.name,
    line: station.line,
    role: stationRole(ctx.state, ctx.context.principalId, station.id)!,
    machine: (() => {
      const machine = own(station.readings, FIELDS.machine);
      return machine && typeof machine.value === 'string' ? machine.value : undefined;
    })(),
    openStop: openStop(ctx.state, station.id) !== undefined,
    attention: attentionItems(ctx, station).length,
    mode: station.mode,
    seat: station.seat,
    stale: isStale(ctx, station),
  });
}
/** Unsure readings and held screen procedures: everything that waits for a person. */
function attentionItems(ctx: Context, station: Station) {
  const readings = openAttention(ctx.state, station.id)
    .sort((a, b) => a.createdAt - b.createdAt || byCodePoint(a.id, b.id))
    .map((item) =>
      compact({
        id: item.id,
        station: item.station,
        kind: 'reading' as const,
        title: `Check ${item.field}`,
        detail: `The station screen was read as ${JSON.stringify(item.proposed)} with ${Math.round(item.confidence * 100)}% confidence.`,
        field: item.field,
        proposed: item.proposed,
        confidence: item.confidence,
        source: item.source,
        createdAt: item.createdAt,
      }),
    );
  const held = ctx.effects({ target: hmiTarget(station.id), held: true }).map((effect) =>
    compact({
      id: `reconcile:${effect.id}`,
      station: station.id,
      kind: 'reconcile' as const,
      title: `Check the station: was ${String((effect.payload as { recipe?: string }).recipe ?? effect.type)} loaded?`,
      detail: effect.holdReason,
      effectId: effect.id,
      createdAt: effect.heldAt ?? effect.createdAt,
    }),
  );
  return [...held, ...readings];
}

/** Apply a target's outcome to the record that forwarded it, in the settling transaction. */
function applyOutcome(ctx: Context, effect: Effect, outcome: EffectOutcome): Synchronized['sync'] {
  const separator = effect.resource.indexOf(':');
  const type = effect.resource.slice(0, separator);
  const id = effect.resource.slice(separator + 1);
  const station = type === 'station' ? own(ctx.state.stations, id) : undefined;
  const record: Partial<Synchronized> | undefined =
    type === 'stop'
      ? own(ctx.state.stops, id)
      : type === 'count'
        ? own(ctx.state.counts, id)
        : station?.desired;
  if (!record || record.effectId !== effect.id)
    throw new ApplicationError('NOT_FOUND', 'Synchronized record unavailable');
  record.sync = outcome.status;
  if (outcome.status === 'accepted' && outcome.externalRef) record.sorRef = outcome.externalRef;
  if (outcome.status === 'rejected')
    record.rejection = { code: outcome.code, message: outcome.message };
  // The station loaded the recipe: the order is now the active one there.
  if (station?.desired && outcome.status === 'accepted') {
    const previous = station.orderId ? own(ctx.state.orders, station.orderId) : undefined;
    if (previous && previous.id !== station.desired.orderId) {
      previous.status = 'completed';
      ctx.change(`order:${previous.id}`);
    }
    const order = own(ctx.state.orders, station.desired.orderId);
    if (order) {
      order.status = 'active';
      ctx.change(`order:${order.id}`);
    }
    station.orderId = station.desired.orderId;
  }
  ctx.change(effect.resource);
  return outcome.status;
}

function handler<C extends AnyCapability>(
  capability: C,
  handle: (input: InputOf<C>, context: Context) => OutputOf<C> | Promise<OutputOf<C>>,
): HandlerContribution<LineState, LineServices, C> {
  return { capability, handle };
}

/**
 * Domain handlers never touch the MES or the station screen. Requests to either are queued in
 * the outbox; observations and outcomes come back through integration commands.
 */
export function createLineHandlers(): HandlerContribution<LineState, LineServices>[] {
  return [
    handler(operations.stationList, (_, ctx) => ({
      items: accessibleStations(ctx).map((station) => summary(ctx, station)),
    })),
    handler(operations.stationGet, (input, ctx) => {
      const station = stationOf(ctx.state, input.station);
      const stop = openStop(ctx.state, station.id);
      const order = station.orderId ? own(ctx.state.orders, station.orderId) : undefined;
      return compact({
        ...summary(ctx, station),
        countersRevision: ctx.getRevision(counters(station.id)),
        bridge: compact({
          mode: station.mode,
          seat: station.seat,
          seatChangedBy: station.seatChangedBy,
          seatChangedAt: station.seatChangedAt,
          screen: station.screen,
          observedAt: station.observedAt,
          profile: station.profile,
          localInputAt: station.localInputAt,
          stale: isStale(ctx, station),
        }),
        readings: Object.fromEntries(
          Object.entries(station.readings).map(([field, reading]) => [
            field,
            readingDto(ctx, reading),
          ]),
        ),
        order: order ? { ...order } : undefined,
        desired: desiredDto(ctx, station),
        currentStop: stop ? stopDto(ctx, stop) : undefined,
      });
    }),
    handler(operations.stopList, (input, ctx) => {
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
    }),
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
    handler(operations.syncStatus, (_, ctx) => {
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
        .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0))
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
      return compact({
        watermark: ctx.state.watermark,
        lastSyncAt: ctx.state.lastSyncAt,
        // The MES integration reads only its watermark here.
        targets: visible.size ? targets : [],
        rejections,
      });
    }),
    handler(operations.controlGet, (input, ctx) => {
      const station = stationOf(ctx.state, input.station);
      return { mode: station.mode, seat: station.seat };
    }),
    handler(operations.orderStart, (input, ctx) => {
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
        throw new ApplicationError(
          'CONFLICT',
          'A recipe load is already in progress at this station',
        );
      const machine = own(station.readings, FIELDS.machine);
      // A fail-fast check on what we observed; the bridge checks the screen itself before acting.
      if (usable(machine, now(ctx)) && machine.value !== 'STOPPED')
        throw new ApplicationError(
          'CONFLICT',
          `Machine is ${String(machine.value)}; stop it first`,
        );
      const requestedAt = now(ctx);
      const effectId = ctx.enqueue({
        target: hmiTarget(station.id),
        type: 'recipe.load',
        resource: `station:${station.id}`,
        payload: {
          recipe: order.recipe,
          order: order.id,
          // Authority-derived: this command is person-only, so the caller is at the station.
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
    }),
    handler(operations.stopClassify, (input, ctx) => {
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
    }),
    handler(operations.countConfirm, (input, ctx) => {
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
          good.status === 'observed' && scrap.status === 'observed'
            ? 'observed'
            : 'operator-verified',
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
    }),
    handler(operations.readingConfirm, (input, ctx) => {
      const item = own(ctx.state.attention, input.attentionId);
      if (!item) throw new ApplicationError('NOT_FOUND', 'Attention item unavailable');
      if (typeof item.proposed === 'number' && typeof input.value !== 'number')
        throw new ApplicationError('INVALID_INPUT', 'Enter a number', { field: 'value' });
      const station = stationOf(ctx.state, item.station);
      const reading: Reading = {
        value: input.value,
        confidence: 1,
        source: 'operator',
        observedAt: now(ctx),
        status: 'operator-verified',
        verifiedBy: ctx.context.principalId,
      };
      if (item.resolvedAt !== undefined)
        throw new ApplicationError('CONFLICT', 'Already resolved', { field: 'attentionId' });
      put(station.readings, item.field, reading);
      item.resolvedAt = reading.observedAt;
      item.resolvedBy = ctx.context.principalId;
      item.resolution = 'confirmed';
      ctx.change(`attention:${item.id}`);
      ctx.change(`station:${station.id}`);
      if (item.field === FIELDS.good || item.field === FIELDS.scrap)
        ctx.change(counters(station.id));
      return { station: station.id, field: item.field, reading: readingDto(ctx, reading) };
    }),
    handler(operations.effectReconcile, (input, ctx) => {
      const effect = heldEffect(ctx, input.effectId);
      const station = effect
        ? own(ctx.state.stations, stationOfResource(ctx.state, effect.resource) ?? '')
        : undefined;
      const role = station
        ? stationRole(ctx.state, ctx.context.principalId, station.id)
        : undefined;
      // Policy cannot see effects; the station role is checked here, before anything changes.
      if (
        !effect ||
        !station ||
        effect.target !== hmiTarget(station.id) ||
        (role !== 'operator' && role !== 'supervisor')
      )
        throw new ApplicationError('NOT_FOUND', 'No held procedure to reconcile');
      if (input.applied) {
        const outcome = {
          status: 'accepted' as const,
          externalRef: `operator:${ctx.context.principalId}`,
        };
        ctx.settleEffect(effect.id, outcome);
        return { station: station.id, sync: applyOutcome(ctx, effect, outcome) };
      }
      ctx.releaseEffect(effect.id);
      ctx.change(effect.resource);
      return { station: station.id, sync: 'pending' as const };
    }),
    handler(operations.bridgeSetMode, (input, ctx) => {
      const station = stationOf(ctx.state, input.station);
      station.mode = input.mode;
      ctx.change(`station:${station.id}`);
      return { station: station.id, mode: station.mode };
    }),
    handler(operations.seatRequest, (input, ctx) => {
      const station = stationOf(ctx.state, input.station);
      station.seat = input.seat;
      station.seatChangedBy = ctx.context.principalId;
      station.seatChangedAt = now(ctx);
      ctx.change(`station:${station.id}`);
      return { station: station.id, seat: station.seat };
    }),
    handler(operations.stationSetMember, (input, ctx) => {
      const station = stationOf(ctx.state, input.station);
      if (input.principalId === ctx.context.principalId)
        throw new ApplicationError('FORBIDDEN', 'You cannot change your own station role');
      // Integration principals act through their own narrow lanes, never through roles.
      if (
        input.principalId === ctx.state.mesPrincipalId ||
        bridgeStation(ctx.state, input.principalId) !== undefined
      )
        throw new ApplicationError('FORBIDDEN', 'Integration principals have no station role');
      if (input.role === null) delete station.members[input.principalId];
      else put(station.members, input.principalId, input.role);
      ctx.change(`station:${station.id}`, 'authorization.changed');
      return { station: station.id, members: { ...station.members } };
    }),
    handler(operations.observationIngest, (input, ctx) => {
      const station = stationOf(ctx.state, input.station);
      // A slow observation pass finishing after a newer one never rolls state back.
      if (station.observedAt !== undefined && input.observedAt < station.observedAt)
        return { station: station.id, applied: false };
      station.screen = input.screen;
      station.observedAt = input.observedAt;
      station.profile = { ...input.profile };
      if (input.localInput) station.localInputAt = input.observedAt;
      const previousMachine = own(station.readings, FIELDS.machine)?.value;
      const before = [FIELDS.good, FIELDS.scrap].map(
        (field) => own(station.readings, field)?.value,
      );
      for (const reading of input.readings) {
        const [open] = openAttention(ctx.state, station.id, reading.field);
        if (reading.status === 'observed') {
          put(
            station.readings,
            reading.field,
            compact({
              value: reading.value,
              confidence: reading.confidence,
              source: reading.extractor,
              model: reading.model,
              observedAt: reading.observedAt,
              status: 'observed' as const,
            }),
          );
          // A confident reading answers the open question about this field.
          if (open) {
            open.resolvedAt = reading.observedAt;
            open.resolution = 'superseded';
            ctx.change(`attention:${open.id}`);
          }
          continue;
        }
        // An unsure value never overwrites the record; a person confirms or corrects it.
        const current = own(station.readings, reading.field);
        // Agreeing with what is on record raises no question; the record just does not get fresher.
        if (current !== undefined && current.value === reading.value) continue;
        if (open && open.proposed === reading.value) continue;
        const item: AttentionItem = compact({
          id: open?.id ?? newId(ctx),
          station: station.id,
          field: reading.field,
          proposed: reading.value,
          confidence: reading.confidence,
          source: reading.extractor,
          model: reading.model,
          observedAt: reading.observedAt,
          createdAt: open?.createdAt ?? now(ctx),
        });
        put(ctx.state.attention, item.id, item);
        ctx.change(`attention:${item.id}`);
      }
      const after = [FIELDS.good, FIELDS.scrap].map((field) => own(station.readings, field)?.value);
      if (before.some((value, index) => value !== after[index])) ctx.change(counters(station.id));

      // Stops are transitions the bridge saw with confidence: RUNNING → STOPPED/ALARM opens one,
      // → RUNNING closes it. A first observation of a stopped machine has no known start.
      let openedStop: string | undefined;
      let closedStop: string | undefined;
      const machine = input.readings.find(
        (reading) => reading.field === FIELDS.machine && reading.status === 'observed',
      );
      const alarm = input.readings.find(
        (reading) => reading.field === FIELDS.alarm && reading.status === 'observed',
      );
      const current = openStop(ctx.state, station.id);
      if (machine && (machine.value === 'STOPPED' || machine.value === 'ALARM')) {
        if (!current && previousMachine === 'RUNNING') {
          const stop: Stop = compact({
            id: newId(ctx),
            station: station.id,
            orderId: station.orderId,
            state: machine.value,
            alarm: typeof alarm?.value === 'string' && alarm.value ? alarm.value : undefined,
            startedAt: machine.observedAt,
          });
          put(ctx.state.stops, stop.id, stop);
          ctx.change(`stop:${stop.id}`);
          openedStop = stop.id;
        } else if (current && machine.value === 'ALARM' && current.state === 'STOPPED') {
          current.state = 'ALARM';
          if (typeof alarm?.value === 'string' && alarm.value) current.alarm = alarm.value;
          ctx.change(`stop:${current.id}`);
        }
      } else if (machine?.value === 'RUNNING' && current) {
        current.endedAt = machine.observedAt;
        ctx.change(`stop:${current.id}`);
        closedStop = current.id;
      }
      ctx.change(`station:${station.id}`);
      return compact({ station: station.id, applied: true, openedStop, closedStop });
    }),
    handler(operations.mesSync, (input, ctx) => {
      // Watermarks order sync batches; a stale or replayed range cannot reapply old data.
      if (input.from !== ctx.state.watermark)
        throw new ApplicationError('CONFLICT', 'Watermark changed', {
          watermark: ctx.state.watermark ?? null,
        });
      for (const { closed, ...snapshot } of input.orders) {
        // Orders for unknown stations are ignored; stations are configured, never inferred.
        if (!own(ctx.state.stations, snapshot.station)) continue;
        const existing = own(ctx.state.orders, snapshot.id);
        put(ctx.state.orders, snapshot.id, {
          ...snapshot,
          status: closed ? 'completed' : (existing?.status ?? 'released'),
        });
        ctx.change(`order:${snapshot.id}`);
      }
      for (const reason of input.reasons ?? []) put(ctx.state.reasons, reason.code, { ...reason });
      ctx.state.watermark = input.to;
      ctx.state.lastSyncAt = now(ctx);
      ctx.change('mes:sync');
      return { watermark: input.to, orders: input.orders.length };
    }),
    handler(operations.effectSettle, (input, ctx) => {
      const effect = ctx.effects().find((candidate) => candidate.id === input.effectId);
      if (!effect) throw new ApplicationError('NOT_FOUND', 'Effect unavailable');
      // Each integration principal settles only its own target, checked against the effect here.
      const bridge = bridgeStation(ctx.state, ctx.context.principalId);
      const own =
        (bridge !== undefined && effect.target === hmiTarget(bridge.id)) ||
        (ctx.context.principalId === ctx.state.mesPrincipalId && effect.target === MES);
      if (!own) throw new ApplicationError('FORBIDDEN', 'Effect belongs to another integration');
      const settled = ctx.settleEffect(effect.id, input.outcome as EffectOutcome);
      return {
        resource: settled.resource,
        sync: applyOutcome(ctx, settled, input.outcome as EffectOutcome),
      };
    }),
  ];
}
export { lineStationModule } from './contracts';
export { createLineState } from './domain';
export { linePolicy } from './policy';

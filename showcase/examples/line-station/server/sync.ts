import { ApplicationError } from '@agent-native/contracts';
import type { Effect, EffectOutcome } from '@agent-native/runtime';
import { own, type Synchronized } from '../domain';
import type { Context } from './context';

/** Apply a target's outcome to the record that forwarded it, in the settling transaction. */
export function applyOutcome(
  ctx: Context,
  effect: Effect,
  outcome: EffectOutcome,
): Synchronized['sync'] {
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

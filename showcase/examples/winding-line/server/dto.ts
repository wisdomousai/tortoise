import type { Effect } from '@tortoise/runtime';
import {
  FIELDS,
  FRESH_MS,
  openStop,
  own,
  stationRole,
  usable,
  type CountReport,
  type Reading,
  type Station,
  type Stop,
} from '../domain';
import { isStale } from './access';
import { attentionItems } from './attention';
import { compact, now, type Context } from './context';

export const readingDto = (ctx: Context, reading: Reading) =>
  compact({ ...reading, stale: now(ctx) - reading.observedAt > FRESH_MS });
export const stopDto = (ctx: Context, stop: Stop, changed = false) => {
  const { effectId: _effectId, ...rest } = stop;
  return compact({ ...rest, revision: ctx.getRevision(`stop:${stop.id}`) + Number(changed) });
};
export const countDto = ({ effectId: _effectId, ...count }: CountReport) => count;
export function heldEffect(ctx: Context, effectId: string | undefined): Effect | undefined {
  return effectId
    ? ctx.effects({ held: true }).find((effect) => effect.id === effectId)
    : undefined;
}
export function desiredDto(ctx: Context, station: Station) {
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
/** A station as listed: role, machine state, open stop, attention count and bridge state. */
export function summary(ctx: Context, station: Station, changed = false) {
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
    controlledBy: station.controlledBy,
    stale: isStale(ctx, station),
  });
}

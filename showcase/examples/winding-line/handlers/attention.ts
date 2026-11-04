import { ApplicationError, type InputOf, type OutputOf } from '@tortoise/contracts';
import type { HandlerContribution } from '@tortoise/runtime';
import { operations } from '../contracts';
import { FIELDS, hmiTarget, own, put, stationRole, type LineState, type Reading } from '../domain';
import { stationOfResource } from '../policy';
import { stationOf, counters } from '../server/access';
import { declaration, acceptsValue } from '../server/attention';
import { now, handler, type Context, type LineServices } from '../server/context';
import { readingDto, heldEffect } from '../server/dto';
import { applyOutcome } from '../server/sync';

/** A person confirms or corrects an unsure reading; it becomes operator-verified. */
function confirmReading(
  input: InputOf<typeof operations.readingConfirm>,
  ctx: Context,
): OutputOf<typeof operations.readingConfirm> {
  const item = own(ctx.state.attention, input.attentionId);
  if (!item) throw new ApplicationError('NOT_FOUND', 'Attention item unavailable');
  const declared = declaration(item);
  if (!acceptsValue(declared, input.value))
    throw new ApplicationError(
      'INVALID_INPUT',
      declared.type === 'enum'
        ? `Choose one of: ${(declared.options ?? []).join(', ')}`
        : `Enter a ${declared.type === 'text' ? 'non-empty text' : declared.type} value`,
      { field: 'value' },
    );
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
  if (item.field === FIELDS.good || item.field === FIELDS.scrap) ctx.change(counters(station.id));
  return { station: station.id, field: item.field, reading: readingDto(ctx, reading) };
}

/** A person who checked the station completes a held procedure or lets the bridge rerun it. */
function reconcileEffect(
  input: InputOf<typeof operations.effectReconcile>,
  ctx: Context,
): OutputOf<typeof operations.effectReconcile> {
  const effect = heldEffect(ctx, input.effectId);
  const station = effect
    ? own(ctx.state.stations, stationOfResource(ctx.state, effect.resource) ?? '')
    : undefined;
  const role = station ? stationRole(ctx.state, ctx.context.principalId, station.id) : undefined;
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
    ctx.completeEffect(effect.id, outcome);
    return { station: station.id, sync: applyOutcome(ctx, effect, outcome) };
  }
  ctx.releaseEffect(effect.id);
  ctx.change(effect.resource);
  return { station: station.id, sync: 'pending' as const };
}

/** What a person resolves: unsure readings and held screen procedures. */
export function attentionHandlers(): HandlerContribution<LineState, LineServices>[] {
  return [
    handler(operations.readingConfirm, confirmReading),
    handler(operations.effectReconcile, reconcileEffect),
  ];
}

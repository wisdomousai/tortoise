import { randomUUID } from 'node:crypto';
import {
  ApplicationError,
  type AnyCapability,
  type InputOf,
  type JsonValue,
  type OutputOf,
} from '@agent-native/contracts';
import type { EffectOutcome, HandlerContext, HandlerContribution } from '@agent-native/runtime';
import { operations } from './contracts';
import {
  activeResults,
  evaluate,
  own,
  percentile,
  plantRole,
  progress,
  put,
  type Defect,
  type InspectionLot,
  type InspectionResult,
  type QualityState,
  type Synchronized,
  type UsageDecision,
} from './domain';
import { plantOfResource } from './policy';

export interface QualityServices {
  newId?: () => string;
  /** Authority clock for recordedAt and occurredAt skew checks. */
  now?: () => number;
}
type Context = HandlerContext<QualityState, QualityServices>;
type Measurement = {
  characteristicId: string;
  sample?: number;
  value?: number;
  code?: string;
  occurredAt: number;
  capture?: { durationMs: number; input: 'keyboard' | 'scanner' | 'instrument' | 'touch' };
};

const TARGET = 'quality-system';
/** Paper backlogs are entered later the same shift; anything older needs the SoR's own process. */
const MAX_AGE_MS = 24 * 3_600_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
/** Defect codes are published by the SoR in this code group. */
export const DEFECT_CODE_GROUP = 'defects';

/** Locale-independent ordering keeps results identical on every host. */
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** JSON state and DTOs never hold `undefined`; optional members are omitted. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
function invalid(field: string, message: string): never {
  // `field` lets form bindings attach the message to the input that caused it.
  throw new ApplicationError('INVALID_INPUT', message, { field });
}
function lotOf(state: QualityState, id: string): InspectionLot {
  const lot = own(state.lots, id);
  if (!lot) throw new ApplicationError('NOT_FOUND', 'Inspection lot unavailable');
  return lot;
}
function requireOpen(lot: InspectionLot): void {
  if (lot.status !== 'open')
    throw new ApplicationError('CONFLICT', `Inspection lot is ${lot.status}`, {
      status: lot.status,
    });
}
const now = (ctx: Context) => (ctx.services.now ?? Date.now)();
const newId = (ctx: Context) => (ctx.services.newId ?? randomUUID)();
const withoutEffect = <T extends Synchronized>({ effectId: _effectId, ...value }: T) => value;
const resultDto = (ctx: Context, result: InspectionResult, changed = false) => ({
  ...withoutEffect(result),
  revision: ctx.getRevision(`result:${result.id}`) + Number(changed),
});
const defectDto = (ctx: Context, defect: Defect, changed = false) => ({
  ...withoutEffect(defect),
  revision: ctx.getRevision(`defect:${defect.id}`) + Number(changed),
});
function lotSummary(ctx: Context, lot: InspectionLot, changed = false) {
  const { next: _next, ...counts } = progress(ctx.state, lot);
  return compact({
    id: lot.id,
    revision: ctx.getRevision(`lot:${lot.id}`) + Number(changed),
    plant: lot.plant,
    material: lot.material,
    materialText: lot.materialText,
    batch: lot.batch,
    quantity: lot.quantity,
    unit: lot.unit,
    status: lot.status,
    ...counts,
  });
}
function accessiblePlants(ctx: Context): Set<string> {
  return new Set(
    Object.keys(ctx.state.plants).filter((plant) =>
      plantRole(ctx.state, ctx.context.principalId, plant),
    ),
  );
}
/** Resource-limited delegations name lots; list queries honor them before counting. */
function grantAllowsLot(ctx: Context, lotId: string): boolean {
  return !ctx.context.grant?.resources || ctx.context.grant.resources.includes(`lot:${lotId}`);
}

/**
 * Validate and append one result, then queue its forwarding effect in the same transaction.
 * Corrections reuse the original characteristic and sample and link both records.
 */
function appendResult(
  ctx: Context,
  lot: InspectionLot,
  measurement: Measurement,
  station: string | undefined,
  correction?: { original: InspectionResult; reason: string },
): InspectionResult {
  const characteristic = lot.characteristics.find(
    (item) => item.id === measurement.characteristicId,
  );
  if (!characteristic) invalid('characteristicId', 'Unknown characteristic for this lot');
  if (characteristic.kind === 'quantitative') {
    if (measurement.value === undefined || measurement.code !== undefined)
      invalid('value', 'Enter a measured value');
    if (characteristic.decimals !== undefined) {
      const scaled = measurement.value * 10 ** characteristic.decimals;
      if (Math.abs(scaled - Math.round(scaled)) > 1e-6)
        invalid('value', `Use at most ${characteristic.decimals} decimal places`);
    }
  } else {
    if (measurement.code === undefined || measurement.value !== undefined)
      invalid('code', 'Select a code');
    const group = own(ctx.state.codeGroups, characteristic.codeGroup ?? '');
    if (!group?.codes.some((code) => code.code === measurement.code))
      invalid('code', 'Unknown code for this characteristic');
  }
  const recordedAt = now(ctx);
  if (recordedAt - measurement.occurredAt > MAX_AGE_MS)
    invalid('occurredAt', 'Measurement time is more than 24 hours old');
  if (measurement.occurredAt - recordedAt > MAX_CLOCK_SKEW_MS)
    invalid('occurredAt', 'Measurement time is in the future');
  let sample = measurement.sample;
  if (!correction) {
    const taken = new Set(
      activeResults(ctx.state, lot.id)
        .filter((result) => result.characteristicId === characteristic.id)
        .map((result) => result.sample),
    );
    if (sample === undefined) {
      for (let candidate = 1; candidate <= characteristic.sampleSize; candidate++)
        if (!taken.has(candidate)) {
          sample = candidate;
          break;
        }
      if (sample === undefined)
        throw new ApplicationError('CONFLICT', 'All samples are recorded', { field: 'sample' });
    } else if (sample > characteristic.sampleSize)
      invalid('sample', `Sample must be between 1 and ${characteristic.sampleSize}`);
    else if (taken.has(sample))
      throw new ApplicationError('CONFLICT', 'Sample already recorded; correct it instead', {
        field: 'sample',
      });
  }
  const id = newId(ctx);
  if (own(ctx.state.results, id)) throw new ApplicationError('CONFLICT', 'Identifier exists');
  const result: InspectionResult = compact({
    id,
    lotId: lot.id,
    characteristicId: characteristic.id,
    sample: correction ? correction.original.sample : sample!,
    value: measurement.value,
    code: measurement.code,
    evaluation: evaluate(ctx.state, characteristic, measurement),
    occurredAt: measurement.occurredAt,
    recordedAt,
    recordedBy: ctx.context.principalId,
    station,
    supersedes: correction?.original.id,
    reason: correction?.reason,
    // Delegated runs and grants are agents; telemetry is reported, never trusted for access.
    capture: compact({
      actor:
        ctx.context.runId !== undefined || ctx.context.grant !== undefined
          ? ('agent' as const)
          : ('human' as const),
      durationMs: measurement.capture?.durationMs,
      input: measurement.capture?.input,
    }),
    effectId: '',
    sync: 'pending' as const,
  });
  result.effectId = ctx.enqueue({
    target: TARGET,
    type: correction ? 'result.correct' : 'result.post',
    resource: `result:${id}`,
    payload: compact({
      lot: lot.id,
      characteristic: characteristic.code,
      sample: result.sample,
      value: result.value,
      code: result.code,
      occurredAt: result.occurredAt,
      recordedBy: result.recordedBy,
      station,
      supersedesRef: correction?.original.sorRef,
      reason: correction?.reason,
    }) as JsonValue,
  });
  put(ctx.state.results, id, result);
  ctx.change(`result:${id}`);
  // New data changes what a supervisor reviewed, so a stale decision conflicts.
  ctx.change(`lot:${lot.id}`);
  return result;
}

function handler<C extends AnyCapability>(
  capability: C,
  handle: (input: InputOf<C>, context: Context) => OutputOf<C> | Promise<OutputOf<C>>,
): HandlerContribution<QualityState, QualityServices, C> {
  return { capability, handle };
}

/** Domain handlers never call the SoR; forwarding is queued and settled through commands. */
export function createQualityHandlers(): HandlerContribution<QualityState, QualityServices>[] {
  return [
    handler(operations.lotList, (input, ctx) => {
      const plants = accessiblePlants(ctx);
      const search = input.search?.toLowerCase();
      const items = Object.values(ctx.state.lots)
        .filter(
          (lot) =>
            plants.has(lot.plant) &&
            grantAllowsLot(ctx, lot.id) &&
            (input.plant === undefined || lot.plant === input.plant) &&
            (input.status === undefined || lot.status === input.status) &&
            (search === undefined ||
              `${lot.id} ${lot.material} ${lot.materialText} ${lot.batch ?? ''}`
                .toLowerCase()
                .includes(search)),
        )
        .sort(
          (a, b) =>
            Number(a.status !== 'open') - Number(b.status !== 'open') || byCodePoint(a.id, b.id),
        );
      const offset = input.offset ?? 0;
      return {
        count: items.length,
        items: items.slice(offset, offset + (input.limit ?? 50)).map((lot) => lotSummary(ctx, lot)),
      };
    }),
    handler(operations.lotGet, (input, ctx) => {
      const lot = lotOf(ctx.state, input.id);
      const results = activeResults(ctx.state, lot.id);
      const { next } = progress(ctx.state, lot);
      return compact({
        ...lotSummary(ctx, lot),
        characteristics: lot.characteristics.map((characteristic) => ({
          ...characteristic,
          results: results
            .filter((result) => result.characteristicId === characteristic.id)
            .sort((a, b) => a.sample - b.sample)
            .map((result) => resultDto(ctx, result)),
        })),
        defects: Object.values(ctx.state.defects)
          .filter((defect) => defect.lotId === lot.id)
          .sort((a, b) => a.recordedAt - b.recordedAt || byCodePoint(a.id, b.id))
          .map((defect) => defectDto(ctx, defect)),
        decision: lot.decision ? withoutEffect(lot.decision) : undefined,
        next,
      });
    }),
    handler(operations.worklist, (input, ctx) => {
      const lot = lotOf(ctx.state, input.lotId);
      const { next, recorded, required } = progress(ctx.state, lot);
      return { lotId: lot.id, next, remaining: lot.status === 'open' ? required - recorded : 0 };
    }),
    handler(operations.codeList, (_, ctx) => ({
      groups: accessiblePlants(ctx).size
        ? Object.values(ctx.state.codeGroups).sort((a, b) => byCodePoint(a.id, b.id))
        : [],
    })),
    handler(operations.plantList, (_, ctx) => ({
      items: [...accessiblePlants(ctx)].sort().map((plant) => {
        const role = plantRole(ctx.state, ctx.context.principalId, plant)!;
        return role === 'supervisor'
          ? { plant, role, members: { ...ctx.state.plants[plant]!.members } }
          : { plant, role };
      }),
    })),
    handler(operations.syncStatus, (_, ctx) => {
      const plants = accessiblePlants(ctx);
      const visible = (resource: string) => {
        const plant = plantOfResource(ctx.state, resource);
        const lotId = resource.startsWith('lot:') ? resource.slice(4) : undefined;
        return plant !== undefined && plants.has(plant) && (!lotId || grantAllowsLot(ctx, lotId));
      };
      const records: { resource: string; lotId: string; record: Synchronized; active: boolean }[] =
        [
          ...Object.values(ctx.state.results).map((result) => ({
            resource: `result:${result.id}`,
            lotId: result.lotId,
            record: result as Synchronized,
            active: result.supersededBy === undefined,
          })),
          ...Object.values(ctx.state.defects).map((defect) => ({
            resource: `defect:${defect.id}`,
            lotId: defect.lotId,
            record: defect as Synchronized,
            active: true,
          })),
          ...Object.values(ctx.state.lots).flatMap((lot) =>
            lot.decision
              ? [{ resource: `lot:${lot.id}`, lotId: lot.id, record: lot.decision, active: true }]
              : [],
          ),
        ].filter((entry) => visible(entry.resource) && grantAllowsLot(ctx, entry.lotId));
      const pendingEffects = ctx
        .effects({ status: 'pending', target: TARGET })
        .filter((effect) => visible(effect.resource));
      const count = (status: Synchronized['sync']) =>
        records.filter((entry) => entry.record.sync === status).length;
      return compact({
        watermark: ctx.state.watermark,
        lastSyncAt: ctx.state.lastSyncAt,
        pending: count('pending'),
        accepted: count('accepted'),
        rejected: count('rejected'),
        retrying: pendingEffects.filter((effect) => effect.attempts > 0).length,
        oldestPendingAt: pendingEffects[0]?.createdAt,
        // A superseded rejection was resolved by its correction.
        rejections: records
          .filter((entry) => entry.active && entry.record.sync === 'rejected')
          .slice(0, 50)
          .map((entry) => ({
            resource: entry.resource,
            lotId: entry.lotId,
            code: entry.record.rejection?.code ?? 'REJECTED',
            message: entry.record.rejection?.message ?? 'Rejected by the quality system',
          })),
      });
    }),
    handler(operations.metricsSummary, (input, ctx) => {
      const plants = accessiblePlants(ctx);
      const since = input.since ?? 0;
      const inScope = (lotId: string) => {
        const plant = own(ctx.state.lots, lotId)?.plant;
        return (
          plant !== undefined &&
          plants.has(plant) &&
          (input.plant === undefined || plant === input.plant) &&
          grantAllowsLot(ctx, lotId)
        );
      };
      const results = Object.values(ctx.state.results).filter(
        (result) => result.recordedAt >= since && inScope(result.lotId),
      );
      const captures = results.filter((result) => result.supersedes === undefined);
      const timing = (actor: 'human' | 'agent') => {
        const samples = captures
          .filter((result) => result.capture.actor === actor)
          .flatMap((result) =>
            result.capture.durationMs === undefined ? [] : [result.capture.durationMs],
          );
        return compact({
          count: captures.filter((result) => result.capture.actor === actor).length,
          medianMs: percentile(samples, 0.5),
          p90Ms: percentile(samples, 0.9),
        });
      };
      const visible = (resource: string) => {
        const plant = plantOfResource(ctx.state, resource);
        const lotId = resource.startsWith('result:')
          ? own(ctx.state.results, resource.slice(7))?.lotId
          : undefined;
        return plant !== undefined && (lotId === undefined || inScope(lotId));
      };
      const effects = ctx
        .effects({ target: TARGET })
        .filter((effect) => effect.createdAt >= since && visible(effect.resource));
      const acceptance = effects.flatMap((effect) =>
        effect.status === 'accepted' && effect.settledAt !== undefined
          ? [effect.settledAt - effect.createdAt]
          : [],
      );
      return {
        datapoints: captures.length,
        human: timing('human'),
        agent: timing('agent'),
        corrections: results.length - captures.length,
        outOfTolerance: results.filter(
          (result) => result.supersededBy === undefined && result.evaluation === 'rejected',
        ).length,
        forwarding: {
          pending: effects.filter((effect) => effect.status === 'pending').length,
          rejected: effects.filter((effect) => effect.status === 'rejected').length,
          accepted: compact({
            count: acceptance.length,
            medianMs: percentile(acceptance, 0.5),
            p90Ms: percentile(acceptance, 0.9),
          }),
        },
      };
    }),
    handler(operations.resultRecord, (input, ctx) => {
      const lot = lotOf(ctx.state, input.lotId);
      requireOpen(lot);
      const { lotId: _lotId, station, ...measurement } = input;
      return resultDto(ctx, appendResult(ctx, lot, measurement, station), true);
    }),
    handler(operations.resultRecordBatch, (input, ctx) => {
      const lot = lotOf(ctx.state, input.lotId);
      requireOpen(lot);
      // Results are appended in order, so omitted samples advance within the same batch.
      const items = input.results.map((measurement) =>
        appendResult(ctx, lot, measurement, input.station),
      );
      return { items: items.map((result) => resultDto(ctx, result, true)) };
    }),
    handler(operations.resultCorrect, (input, ctx) => {
      const original = own(ctx.state.results, input.resultId);
      if (!original) throw new ApplicationError('NOT_FOUND', 'Result unavailable');
      if (original.supersededBy !== undefined)
        throw new ApplicationError('CONFLICT', 'Result was already corrected');
      const lot = lotOf(ctx.state, original.lotId);
      requireOpen(lot);
      const corrected = appendResult(
        ctx,
        lot,
        compact({
          characteristicId: original.characteristicId,
          value: input.value,
          code: input.code,
          occurredAt: input.occurredAt ?? original.occurredAt,
        }),
        original.station,
        { original, reason: input.reason },
      );
      original.supersededBy = corrected.id;
      ctx.change(`result:${original.id}`);
      return resultDto(ctx, corrected, true);
    }),
    handler(operations.defectRecord, (input, ctx) => {
      const lot = lotOf(ctx.state, input.lotId);
      requireOpen(lot);
      if (
        input.characteristicId !== undefined &&
        !lot.characteristics.some((item) => item.id === input.characteristicId)
      )
        invalid('characteristicId', 'Unknown characteristic for this lot');
      if (
        !own(ctx.state.codeGroups, DEFECT_CODE_GROUP)?.codes.some(
          (code) => code.code === input.code,
        )
      )
        invalid('code', 'Unknown defect code');
      const id = newId(ctx);
      if (own(ctx.state.defects, id)) throw new ApplicationError('CONFLICT', 'Identifier exists');
      const defect: Defect = compact({
        id,
        lotId: lot.id,
        characteristicId: input.characteristicId,
        code: input.code,
        quantity: input.quantity,
        note: input.note,
        recordedBy: ctx.context.principalId,
        recordedAt: now(ctx),
        sync: 'pending' as const,
        effectId: ctx.enqueue({
          target: TARGET,
          type: 'defect.post',
          resource: `defect:${id}`,
          payload: compact({
            lot: lot.id,
            code: input.code,
            quantity: input.quantity,
            characteristic: lot.characteristics.find((item) => item.id === input.characteristicId)
              ?.code,
            note: input.note,
          }) as JsonValue,
        }),
      });
      put(ctx.state.defects, id, defect);
      ctx.change(`defect:${id}`);
      ctx.change(`lot:${lot.id}`);
      return defectDto(ctx, defect, true);
    }),
    handler(operations.decisionSet, (input, ctx) => {
      const lot = lotOf(ctx.state, input.lotId);
      requireOpen(lot);
      const { recorded, required } = progress(ctx.state, lot);
      if (recorded < required)
        throw new ApplicationError('CONFLICT', 'Inspection is incomplete', { recorded, required });
      const decision: UsageDecision = compact({
        code: input.code,
        note: input.note,
        decidedBy: ctx.context.principalId,
        decidedAt: now(ctx),
        sync: 'pending' as const,
        effectId: ctx.enqueue({
          target: TARGET,
          type: 'decision.post',
          resource: `lot:${lot.id}`,
          payload: compact({ lot: lot.id, code: input.code, note: input.note }) as JsonValue,
        }),
      });
      lot.decision = decision;
      lot.status = 'decided';
      ctx.change(`lot:${lot.id}`);
      return {
        lotId: lot.id,
        revision: ctx.getRevision(`lot:${lot.id}`) + 1,
        decision: withoutEffect(decision),
      };
    }),
    handler(operations.plantSetMember, (input, ctx) => {
      const plant = own(ctx.state.plants, input.plant);
      if (!plant) throw new ApplicationError('NOT_FOUND', 'Plant unavailable');
      if (input.principalId === ctx.context.principalId)
        throw new ApplicationError('FORBIDDEN', 'You cannot change your own plant role');
      if (input.principalId === ctx.state.integrationPrincipalId)
        throw new ApplicationError('FORBIDDEN', 'The integration principal has no plant role');
      if (input.role === null) delete plant.members[input.principalId];
      else put(plant.members, input.principalId, input.role);
      ctx.change(`plant:${input.plant}`, 'authorization.changed');
      return { plant: input.plant, members: { ...plant.members } };
    }),
    handler(operations.lotSync, (input, ctx) => {
      // Watermarks make sync batches ordered; a stale or replayed range cannot reapply old data.
      if (input.from !== ctx.state.watermark)
        throw new ApplicationError('CONFLICT', 'Watermark changed', {
          watermark: ctx.state.watermark ?? null,
        });
      for (const snapshot of input.lots) {
        if (!own(ctx.state.plants, snapshot.plant))
          // New plants start without members; access is granted explicitly, never inferred.
          put(ctx.state.plants, snapshot.plant, { members: {} });
        const existing = own(ctx.state.lots, snapshot.id);
        const { closed, ...master } = snapshot;
        const status = existing?.status ?? 'open';
        put(
          ctx.state.lots,
          snapshot.id,
          compact({
            ...master,
            status: closed && status === 'open' ? ('closed' as const) : status,
            decision: existing?.decision,
          }),
        );
        ctx.change(`lot:${snapshot.id}`);
      }
      for (const group of input.codeGroups ?? []) put(ctx.state.codeGroups, group.id, group);
      ctx.state.watermark = input.to;
      ctx.state.lastSyncAt = now(ctx);
      ctx.change('sync:quality');
      return { watermark: input.to, lots: input.lots.length };
    }),
    handler(operations.effectSettle, (input, ctx) => {
      const effect = ctx.settleEffect(input.effectId, input.outcome as EffectOutcome);
      const separator = effect.resource.indexOf(':');
      const type = effect.resource.slice(0, separator);
      const id = effect.resource.slice(separator + 1);
      const record: Synchronized | undefined =
        type === 'result'
          ? own(ctx.state.results, id)
          : type === 'defect'
            ? own(ctx.state.defects, id)
            : type === 'lot'
              ? own(ctx.state.lots, id)?.decision
              : undefined;
      if (!record || record.effectId !== effect.id)
        throw new ApplicationError('NOT_FOUND', 'Synchronized record unavailable');
      record.sync = input.outcome.status;
      if (input.outcome.status === 'accepted' && input.outcome.externalRef)
        record.sorRef = input.outcome.externalRef;
      if (input.outcome.status === 'rejected')
        record.rejection = { code: input.outcome.code, message: input.outcome.message };
      // Only the forwarded record changes; a settlement must not invalidate a supervisor's review.
      ctx.change(effect.resource);
      return { resource: effect.resource, sync: record.sync };
    }),
  ];
}
export { qualityInspectionModule } from './contracts';
export { createQualityState } from './domain';
export { qualityPolicy } from './policy';

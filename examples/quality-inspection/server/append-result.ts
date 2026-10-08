import { ApplicationError, type JsonValue } from '@agent-native/contracts';
import {
  activeResults,
  evaluate,
  own,
  put,
  type InspectionLot,
  type InspectionResult,
} from '../domain';
import {
  compact,
  invalid,
  MAX_AGE_MS,
  MAX_CLOCK_SKEW_MS,
  newId,
  now,
  TARGET,
  type Context,
  type Measurement,
} from './context';

type Characteristic = InspectionLot['characteristics'][number];
type Correction = { original: InspectionResult; reason: string };

/** A value at the declared precision, or a code from the characteristic's code group. */
function checkMeasurement(ctx: Context, characteristic: Characteristic, measurement: Measurement) {
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
}

/** The authority's recording time, refusing a measurement too old or in the future. */
function recordedAtFor(ctx: Context, measurement: Measurement): number {
  const recordedAt = now(ctx);
  if (recordedAt - measurement.occurredAt > MAX_AGE_MS)
    invalid('occurredAt', 'Measurement time is more than 24 hours old');
  if (measurement.occurredAt - recordedAt > MAX_CLOCK_SKEW_MS)
    invalid('occurredAt', 'Measurement time is in the future');
  return recordedAt;
}

/** The named sample if it is free and in range, otherwise the first open one. */
function sampleFor(
  ctx: Context,
  lot: InspectionLot,
  characteristic: Characteristic,
  sample: number | undefined,
): number {
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
  return sample;
}

/** Queue the result for the quality system; a correction names the record it supersedes. */
function forward(
  ctx: Context,
  lot: InspectionLot,
  characteristic: Characteristic,
  result: InspectionResult,
  station: string | undefined,
  correction: Correction | undefined,
): string {
  return ctx.enqueue({
    target: TARGET,
    type: correction ? 'result.correct' : 'result.post',
    resource: `result:${result.id}`,
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
}

/**
 * Validate and append one result, then queue its forwarding effect in the same transaction.
 * Corrections reuse the original characteristic and sample and link both records.
 */
export function appendResult(
  ctx: Context,
  lot: InspectionLot,
  measurement: Measurement,
  station: string | undefined,
  correction?: Correction,
): InspectionResult {
  const characteristic = lot.characteristics.find(
    (item) => item.id === measurement.characteristicId,
  );
  if (!characteristic) invalid('characteristicId', 'Unknown characteristic for this lot');
  checkMeasurement(ctx, characteristic, measurement);
  const recordedAt = recordedAtFor(ctx, measurement);
  const sample = correction
    ? correction.original.sample
    : sampleFor(ctx, lot, characteristic, measurement.sample);
  const id = newId(ctx);
  if (own(ctx.state.results, id)) throw new ApplicationError('CONFLICT', 'Identifier exists');
  const result: InspectionResult = compact({
    id,
    lotId: lot.id,
    characteristicId: characteristic.id,
    sample,
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
  result.effectId = forward(ctx, lot, characteristic, result, station, correction);
  put(ctx.state.results, id, result);
  ctx.change(`result:${id}`);
  // New data changes what a supervisor reviewed, so a stale decision conflicts.
  ctx.change(`lot:${lot.id}`);
  return result;
}

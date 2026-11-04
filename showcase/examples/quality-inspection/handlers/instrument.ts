import { ApplicationError } from '@tortoise/contracts';
import type { HandlerContribution } from '@tortoise/runtime';
import { operations } from '../contracts';
import {
  capturesAnywhere,
  INSTRUMENT_READING_LIMIT,
  INSTRUMENT_READING_TTL_MS,
  own,
  put,
  type InspectionLot,
  type InstrumentProvenance,
  type InstrumentReading,
  type QualityState,
} from '../domain';
import {
  compact,
  handler,
  invalid,
  MAX_CLOCK_SKEW_MS,
  newId,
  now,
  type Context,
  type QualityServices,
} from '../server/context';

const readingDto = (ctx: Context, reading: InstrumentReading, changed = false) => ({
  ...reading,
  revision: ctx.getRevision(`instrument:${reading.id}`) + Number(changed),
});

/**
 * The reading an inspector confirms for one sample, checked inside the recording transaction:
 * unused, recent, in the characteristic's unit, and with the value and time the caller saw. The
 * echo checks mean a confirmation describes exactly the reading on screen, never a newer one.
 */
export function confirmReading(
  ctx: Context,
  lot: InspectionLot,
  input: {
    characteristicId: string;
    value?: number;
    occurredAt: number;
    instrumentReading: string;
  },
): InstrumentProvenance {
  const reading = own(ctx.state.instrumentReadings, input.instrumentReading);
  if (!reading)
    throw new ApplicationError('NOT_FOUND', 'Instrument reading unavailable', {
      field: 'instrumentReading',
    });
  if (reading.usedBy !== undefined)
    throw new ApplicationError('CONFLICT', 'This reading is already recorded', {
      field: 'instrumentReading',
    });
  if (now(ctx) - reading.observedAt > INSTRUMENT_READING_TTL_MS)
    throw new ApplicationError(
      'CONFLICT',
      'The reading is more than 10 minutes old; measure again',
      {
        field: 'instrumentReading',
      },
    );
  // An unknown characteristic is refused by appendResult, with its own message.
  const characteristic = lot.characteristics.find((item) => item.id === input.characteristicId);
  if (characteristic && characteristic.kind !== 'quantitative')
    invalid('instrumentReading', 'Instrument readings are for measured values');
  if (characteristic?.unit !== undefined && characteristic.unit !== reading.unit)
    invalid(
      'instrumentReading',
      `The instrument reads ${reading.unit}; this characteristic is in ${characteristic.unit}`,
    );
  if (input.value !== reading.value)
    invalid('value', 'The value differs from the instrument reading');
  if (input.occurredAt !== reading.observedAt)
    invalid('occurredAt', 'occurredAt must be the time of the instrument reading');
  return { readingId: reading.id, ...reading.device };
}

/** Mark a confirmed reading used by the result that recorded it. */
export function useReading(ctx: Context, readingId: string, resultId: string) {
  own(ctx.state.instrumentReadings, readingId)!.usedBy = resultId;
  ctx.change(`instrument:${readingId}`);
}

/** Drop the oldest readings beyond the limit; results keep their own copy of the provenance. */
function prune(ctx: Context) {
  const readings = Object.values(ctx.state.instrumentReadings).sort(
    (a, b) => a.observedAt - b.observedAt,
  );
  for (const reading of readings.slice(
    0,
    Math.max(0, readings.length - INSTRUMENT_READING_LIMIT),
  )) {
    delete ctx.state.instrumentReadings[reading.id];
    ctx.change(`instrument:${reading.id}`);
  }
}

/** Readings are submitted by the instrument principal and wait for an inspector to confirm one. */
export const instrumentHandlers = (): HandlerContribution<QualityState, QualityServices>[] => [
  handler(operations.instrumentIngest, (input, ctx) => {
    if (input.observedAt - now(ctx) > MAX_CLOCK_SKEW_MS)
      invalid('observedAt', 'Reading time is in the future');
    const id = newId(ctx);
    if (own(ctx.state.instrumentReadings, id))
      throw new ApplicationError('CONFLICT', 'Identifier exists');
    const reading: InstrumentReading = {
      id,
      value: input.value,
      unit: input.unit,
      observedAt: input.observedAt,
      device: compact(input.device),
    };
    put(ctx.state.instrumentReadings, id, reading);
    ctx.change(`instrument:${id}`);
    prune(ctx);
    return readingDto(ctx, reading, true);
  }),
  handler(operations.instrumentReadings, (_input, ctx) => {
    // Only people who capture somewhere see readings; everyone else gets an empty list.
    if (!capturesAnywhere(ctx.state, ctx.context.principalId)) return { readings: [] };
    const since = now(ctx) - INSTRUMENT_READING_TTL_MS;
    const readings = Object.values(ctx.state.instrumentReadings)
      .filter((reading) => reading.usedBy === undefined && reading.observedAt >= since)
      .sort((a, b) => b.observedAt - a.observedAt)
      .slice(0, 5);
    return { readings: readings.map((reading) => readingDto(ctx, reading)) };
  }),
];

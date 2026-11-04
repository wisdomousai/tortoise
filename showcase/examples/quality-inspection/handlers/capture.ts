import { ApplicationError, type JsonValue } from '@tortoise/contracts';
import { type HandlerContribution } from '@tortoise/runtime';
import { operations } from '../contracts';
import { own, put, type Defect, type QualityState } from '../domain';
import { appendResult } from '../server/append-result';
import { confirmReading, useReading } from './instrument';
import {
  TARGET,
  DEFECT_CODE_GROUP,
  compact,
  invalid,
  lotOf,
  requireOpen,
  now,
  newId,
  handler,
  type QualityServices,
} from '../server/context';
import { resultDto, defectDto } from '../server/dto';

/** A defect from the published code group, forwarded like a result. */
const defectRecordHandler = () =>
  handler(operations.defectRecord, (input, ctx) => {
    const lot = lotOf(ctx.state, input.lotId);
    requireOpen(lot);
    if (
      input.characteristicId !== undefined &&
      !lot.characteristics.some((item) => item.id === input.characteristicId)
    )
      invalid('characteristicId', 'Unknown characteristic for this lot');
    if (
      !own(ctx.state.codeGroups, DEFECT_CODE_GROUP)?.codes.some((code) => code.code === input.code)
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
  });

/** Results, batches, corrections and defects for open lots; each queues its forwarding. */
export const captureHandlers = (): HandlerContribution<QualityState, QualityServices>[] => [
  handler(operations.resultRecord, (input, ctx) => {
    const lot = lotOf(ctx.state, input.lotId);
    requireOpen(lot);
    const { lotId: _lotId, station, instrumentReading, ...measurement } = input;
    const instrument =
      instrumentReading === undefined
        ? undefined
        : confirmReading(ctx, lot, { ...measurement, instrumentReading });
    const result = appendResult(ctx, lot, measurement, station, compact({ instrument }));
    if (instrument) useReading(ctx, instrument.readingId, result.id);
    return resultDto(ctx, result, true);
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
      { correction: { original, reason: input.reason } },
    );
    original.supersededBy = corrected.id;
    ctx.change(`result:${original.id}`);
    return resultDto(ctx, corrected, true);
  }),
  defectRecordHandler(),
];

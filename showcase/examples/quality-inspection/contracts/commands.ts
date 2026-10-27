import { z } from 'zod';
import { plantMembership } from './membership';
import { operation } from './operation';
import { qualityTarget } from './target';
import {
  id,
  revision,
  timestamp,
  resultSchema,
  defectSchema,
  decisionSchema,
  instrumentDeviceSchema,
  instrumentReadingSchema,
  measurement,
} from './schemas';
import { instrumentMeasurementSchema } from './instrument';

const capture = { action: 'capture', resourceType: 'InspectionLot' };

/** Writes by people, agents and the quality-system integration principal. */
export const commandOperations = {
  resultRecord: operation(
    'inspection.result.record',
    'command',
    z.strictObject({
      lotId: id,
      station: z.string().max(64).optional(),
      ...measurement,
      instrumentReading: id.optional(),
    }),
    resultSchema,
    capture,
    { dependencies: ['lot', 'result', 'instrument'], integration: true },
  ),
  resultRecordBatch: operation(
    'inspection.result.record-batch',
    'command',
    z.strictObject({
      lotId: id,
      station: z.string().max(64).optional(),
      results: z.array(z.strictObject(measurement)).min(1).max(100),
    }),
    z.strictObject({ items: z.array(resultSchema) }),
    capture,
    {
      dependencies: ['lot', 'result'],
      integration: true,
      exception: 'instrument import by agents and scripts; people record one sample at a time',
    },
  ),
  resultCorrect: operation(
    'inspection.result.correct',
    'command',
    z.strictObject({
      resultId: id,
      value: z.number().optional(),
      code: z.string().min(1).max(32).optional(),
      occurredAt: timestamp.optional(),
      reason: z.string().min(1).max(500),
    }),
    resultSchema,
    { action: 'correct', resourceType: 'InspectionResult' },
    { dependencies: ['lot', 'result'], integration: true },
  ),
  defectRecord: operation(
    'inspection.defect.record',
    'command',
    z.strictObject({
      lotId: id,
      characteristicId: id.optional(),
      code: z.string().min(1).max(32),
      quantity: z.number().int().min(1).max(1_000_000),
      note: z.string().max(1000).optional(),
    }),
    defectSchema,
    capture,
    { dependencies: ['lot', 'defect'], integration: true },
  ),
  decisionSet: operation(
    'inspection.decision.set',
    'command',
    z.strictObject({
      lotId: id,
      code: z.enum(['accept', 'reject', 'conditional']),
      note: z.string().max(1000).optional(),
    }),
    z.strictObject({ lotId: id, revision, decision: decisionSchema }),
    { action: 'decide', resourceType: 'InspectionLot' },
    { dependencies: ['lot'], integration: true },
  ),
  instrumentIngest: operation(
    'inspection.instrument.ingest',
    'command',
    z.strictObject({
      session: z.string().min(1).max(128),
      seq: z.number().int().min(0),
      ...instrumentMeasurementSchema.shape,
      observedAt: timestamp,
      device: instrumentDeviceSchema,
    }),
    instrumentReadingSchema,
    { action: 'observe', resourceType: 'InstrumentReading' },
    { dependencies: ['instrument'], exception: 'instrument driver principal (driver events)' },
  ),
  plantSetMember: plantMembership.setMember,
  lotSync: qualityTarget.sync,
  effectComplete: qualityTarget.complete,
} as const;

import { z } from 'zod';
import { operation } from './operation';
import {
  id,
  revision,
  timestamp,
  syncStatus,
  plantRoleSchema,
  resultSchema,
  defectSchema,
  decisionSchema,
  codeGroupSchema,
  lotSnapshotSchema,
  measurement,
  outcomeSchema,
} from './schemas';

const capture = { action: 'capture', resourceType: 'InspectionLot' };

/** Writes by people, agents and the quality-system integration principal. */
export const commandOperations = {
  resultRecord: operation(
    'inspection.result.record',
    'command',
    z.strictObject({ lotId: id, station: z.string().max(64).optional(), ...measurement }),
    resultSchema,
    capture,
    { dependencies: ['lot', 'result'], integration: true },
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
  plantSetMember: operation(
    'inspection.plant.set-member',
    'command',
    z.strictObject({ plant: id, principalId: id, role: plantRoleSchema.nullable() }),
    z.strictObject({ plant: id, members: z.record(z.string(), plantRoleSchema) }),
    { action: 'administer', resourceType: 'Plant' },
    { dependencies: ['plant'] },
  ),
  lotSync: operation(
    'inspection.lot.sync',
    'command',
    z.strictObject({
      from: z.string().max(256).optional(),
      to: z.string().min(1).max(256),
      lots: z.array(lotSnapshotSchema).max(200),
      codeGroups: z.array(codeGroupSchema).max(100).optional(),
    }),
    z.strictObject({ watermark: z.string(), lots: z.number().int() }),
    { action: 'sync', resourceType: 'InspectionLot' },
    { dependencies: ['lot', 'sync'], exception: 'integration principal (inbound sync job)' },
  ),
  effectSettle: operation(
    'inspection.effect.settle',
    'command',
    z.strictObject({ effectId: id, outcome: outcomeSchema }),
    z.strictObject({ resource: z.string(), sync: syncStatus }),
    { action: 'settle', resourceType: 'Synchronization' },
    {
      dependencies: ['lot', 'result', 'defect'],
      exception: 'integration principal (outbox dispatcher)',
    },
  ),
} as const;

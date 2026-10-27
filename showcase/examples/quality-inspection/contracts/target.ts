import { z } from 'zod';
import { defineTarget } from '@agent-native/contracts';
import { codeGroupSchema, id, lotSnapshotSchema, timestamp } from './schemas';

/**
 * The quality system as a system of record: results, defects and usage decisions are forwarded
 * to it, and its feed delivers lots with their characteristics plus the code catalogs.
 */
export const qualityTarget = defineTarget({
  target: 'quality-system',
  resourceType: 'Synchronization',
  operations: {
    settle: 'inspection.effect.settle',
    sync: 'inspection.lot.sync',
    status: 'inspection.sync.status',
  },
  settles: ['lot', 'result', 'defect'],
  feed: {
    item: lotSnapshotSchema,
    max: 200,
    extra: { codeGroups: z.array(codeGroupSchema).max(100).optional() },
    changes: ['lot'],
  },
  status: {
    pending: z.number().int(),
    accepted: z.number().int(),
    rejected: z.number().int(),
    retrying: z.number().int(),
    oldestPendingAt: timestamp.optional(),
    rejections: z.array(
      z.strictObject({ resource: z.string(), lotId: id, code: z.string(), message: z.string() }),
    ),
  },
  descriptions: {
    settle:
      'Integration principal only: record the quality system outcome for a forwarded result, defect or decision.',
    sync: 'Integration principal only: apply a batch of lots and code groups from the quality system and advance the watermark. A stale from watermark conflicts.',
    status:
      'Summarize synchronization with the quality system for your plants: pending, accepted and rejected records, the oldest pending item, recent rejections and the last master-data sync.',
  },
});

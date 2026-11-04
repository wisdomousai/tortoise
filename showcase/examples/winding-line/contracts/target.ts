import { z } from 'zod';
import { defineTarget } from '@tortoise/contracts';
import { id, orderSnapshotSchema, reasonSchema } from './schemas';

/**
 * The MES as a system of record: stops and counts are forwarded to it, and its inbound sync delivers
 * orders and the stop reason catalog. Station bridges complete their own screen procedures through
 * the same complete operation, so the status query reports every target the caller can see.
 */
export const mesTarget = defineTarget({
  target: 'mes',
  resourceType: 'Synchronization',
  operations: {
    complete: 'line.effect.complete',
    sync: 'line.mes.sync',
    status: 'line.sync.status',
  },
  changes: ['station', 'stop', 'count'],
  inbound: {
    item: orderSnapshotSchema,
    max: 200,
    extra: { reasons: z.array(reasonSchema).max(200).optional() },
    changes: ['order'],
  },
  status: {
    targets: z.array(
      z.strictObject({
        target: z.string(),
        pending: z.number().int(),
        held: z.number().int(),
        retrying: z.number().int(),
        accepted: z.number().int(),
        rejected: z.number().int(),
      }),
    ),
    rejections: z.array(
      z.strictObject({ resource: z.string(), station: id, code: z.string(), message: z.string() }),
    ),
  },
  descriptions: {
    complete:
      'Integration only: record the outcome of a forwarded record (MES) or a screen procedure (station bridge). Each integration principal completes only its own target.',
    sync: 'MES integration only: apply orders and stop reasons from the MES and advance the watermark. A stale from watermark conflicts.',
    status:
      'Summarize synchronization for your stations: records pending, held, accepted and rejected per target (MES and station software), recent rejections and the last MES sync.',
  },
  ui: { status: { binding: 'line.station.bridge' } },
});

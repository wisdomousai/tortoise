import { z } from 'zod';
import { collectionList } from '@agent-native/contracts';
import { lots } from './collections';
import { operation } from './operation';
import {
  id,
  timestamp,
  plantRoleSchema,
  nextSample,
  lotDetailSchema,
  codeGroupSchema,
  latency,
} from './schemas';

const lotRead = { action: 'read', resourceType: 'InspectionLot' };

/** Reads, each authorized per plant before filtering, counting and paging. */
export const queryOperations = {
  lotList: collectionList(lots, {
    id: 'inspection.lot',
    filters: ['plant', 'status'],
    search: true,
    description:
      'List inspection lots at plants where you hold a role, open lots first, with capture progress and synchronization counts. search matches lot, material and batch. Authorization precedes filtering, counting (total) and pagination.',
    dependencies: ['result', 'defect', 'plant'],
  }),
  lotGet: operation(
    'inspection.lot.get',
    'query',
    z.strictObject({ id }),
    lotDetailSchema,
    lotRead,
    {
      dependencies: ['lot', 'result', 'defect', 'sync'],
    },
  ),
  worklist: operation(
    'inspection.worklist',
    'query',
    z.strictObject({ lotId: id }),
    z.strictObject({ lotId: id, next: nextSample.nullable(), remaining: z.number().int() }),
    lotRead,
    {
      dependencies: ['lot', 'result'],
      exception: 'agent capture loop; the capture screen reads the next sample from lot.get',
    },
  ),
  codeList: operation(
    'inspection.code.list',
    'query',
    z.strictObject({}),
    z.strictObject({ groups: z.array(codeGroupSchema) }),
    { action: 'read', resourceType: 'CodeGroup' },
    { dependencies: ['sync'] },
  ),
  plantList: operation(
    'inspection.plant.list',
    'query',
    z.strictObject({}),
    z.strictObject({
      items: z.array(
        z.strictObject({
          plant: id,
          role: plantRoleSchema,
          members: z.record(z.string(), plantRoleSchema).optional(),
        }),
      ),
    }),
    { action: 'read', resourceType: 'Plant' },
    { dependencies: ['plant'] },
  ),
  syncStatus: operation(
    'inspection.sync.status',
    'query',
    z.strictObject({}),
    z.strictObject({
      watermark: z.string().optional(),
      lastSyncAt: timestamp.optional(),
      pending: z.number().int(),
      accepted: z.number().int(),
      rejected: z.number().int(),
      retrying: z.number().int(),
      oldestPendingAt: timestamp.optional(),
      rejections: z.array(
        z.strictObject({ resource: z.string(), lotId: id, code: z.string(), message: z.string() }),
      ),
    }),
    { action: 'read', resourceType: 'Synchronization' },
    { dependencies: ['lot', 'result', 'defect', 'sync'] },
  ),
  metricsSummary: operation(
    'inspection.metrics.summary',
    'query',
    z.strictObject({ plant: id.optional(), since: timestamp.optional() }),
    z.strictObject({
      datapoints: z.number().int(),
      human: latency,
      agent: latency,
      corrections: z.number().int(),
      outOfTolerance: z.number().int(),
      forwarding: z.strictObject({
        pending: z.number().int(),
        rejected: z.number().int(),
        accepted: latency,
      }),
    }),
    { action: 'read', resourceType: 'CaptureMetrics' },
    { dependencies: ['result', 'sync'] },
  ),
} as const;

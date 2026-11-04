import { z } from 'zod';
import { collectionList } from '@tortoise/contracts';
import { lots } from './collections';
import { operation } from './operation';
import { qualityTarget } from './target';
import {
  id,
  timestamp,
  plantRoleSchema,
  nextSample,
  lotDetailSchema,
  codeGroupSchema,
  instrumentReadingSchema,
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
  syncStatus: qualityTarget.status,
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
  instrumentReadings: operation(
    'inspection.instrument.readings',
    'query',
    z.strictObject({}),
    z.strictObject({ readings: z.array(instrumentReadingSchema).max(5) }),
    { action: 'read', resourceType: 'InstrumentReading' },
    { dependencies: ['instrument'] },
  ),
} as const;

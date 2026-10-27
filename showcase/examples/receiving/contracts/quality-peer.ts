import { z } from 'zod';
import { defineDataProvider, definePeerTarget } from '@agent-native/contracts';
import {
  arrivalOperations,
  arrivalResultSchema,
  qualityPeerSurface,
} from '@agent-native/quality-inspection/contracts/peer';

/**
 * The quality-inspection application, called as a peer through its published surface. Posting a
 * line the ERP marked for inspection announces an arrival there as this application's service
 * principal; the feed brings back the outcomes once an inspector closed them.
 */
export const qualityPeer = definePeerTarget({
  target: 'quality',
  resourceType: 'QualitySync',
  surface: qualityPeerSurface,
  settles: ['delivery'],
  feed: {
    query: arrivalOperations.arrivalFeed,
    item: arrivalResultSchema,
    max: 100,
    changes: ['delivery'],
  },
  status: {
    pending: z.number().int(),
    rejected: z.number().int(),
    inspecting: z.number().int(),
    passed: z.number().int(),
    failed: z.number().int(),
  },
  descriptions: {
    settle:
      'Integration principal only: record whether quality inspection took an announced arrival.',
    sync: 'Integration principal only: apply incoming inspection outcomes from quality inspection and advance the watermark. A stale from watermark conflicts.',
    status:
      'Summarize incoming inspection: arrivals waiting to be announced, refused by quality inspection, being inspected, passed and failed, and the last outcome import.',
  },
  destination: {
    id: 'quality-peer',
    purpose: 'Announce received goods for incoming inspection, read outcomes and search lots.',
    dataClasses: ['delivery', 'inspection-lot'],
    availability: 'optional',
    offline: 'queue',
  },
  reads: true,
});

/** An inspection lot as quality inspection lists it, by its lot number. */
export const qualityLotSchema = z.strictObject({
  externalId: z.string(),
  plant: z.string(),
  material: z.string(),
  materialText: z.string(),
  batch: z.string().optional(),
  quantity: z.number(),
  unit: z.string(),
  status: z.enum(['open', 'decided', 'closed']),
});

/** Inspection lots, searched live in quality inspection with the plant roles of your person there. */
export const qualityLots = defineDataProvider({
  id: 'quality.lot',
  target: 'quality',
  identity: 'caller',
  resourceType: 'QualityLot',
  query: z.strictObject({ q: z.string().max(100) }),
  item: qualityLotSchema,
  descriptions: {
    search:
      'Search inspection lots in quality inspection by lot, material or batch, live, as the person you are mapped to there: only lots at their plants. Results are not stored.',
    lookup:
      'Read one inspection lot in quality inspection by its lot number (externalId), live, as the person you are mapped to there. A lot that does not exist or is not at their plants is refused.',
  },
  ui: { lookup: { exception: 'agents resolve a lot number they were given; people search' } },
});

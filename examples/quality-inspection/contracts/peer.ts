import { definePeerSurface } from '@agent-native/contracts';
import { arrivalOperations } from './arrivals';
import { queryOperations } from './queries';

/**
 * What another application may call here over the peer link. Browser-safe; a calling
 * application imports it for `definePeerTarget`.
 *
 * - As its service principal: announce arrivals and read the outcomes of its own.
 * - On behalf of a person mapped to someone here: list and read lots, under that person's
 *   plant roles.
 */
export const qualityPeerSurface = definePeerSurface({
  application: 'quality-inspection',
  commands: [arrivalOperations.arrivalAnnounce],
  queries: [arrivalOperations.arrivalFeed],
  onBehalfOf: { queries: [queryOperations.lotList, queryOperations.lotGet] },
});

export {
  arrivalOperations,
  arrivalResultSchema,
  arrivalOutcomeSchema,
  type ArrivalResult,
} from './arrivals';
export { lotSummarySchema } from './schemas';

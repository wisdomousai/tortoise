import { definePeerApi } from '@agent-native/contracts';
import { inspectionRequestOperations } from './inspection-requests';
import { queryOperations } from './queries';

/**
 * What another application may call here over the peer link. Browser-safe; a calling
 * application imports it for `definePeerTarget`.
 *
 * - As its service principal: create inspection requests and read the outcomes of its own.
 * - On behalf of a person mapped to someone here: list and read lots, under that person's
 *   plant roles.
 */
export const qualityPeerApi = definePeerApi({
  application: 'quality-inspection',
  commands: [inspectionRequestOperations.inspectionRequestCreate],
  queries: [inspectionRequestOperations.inspectionRequestFeed],
  onBehalfOf: { queries: [queryOperations.lotList, queryOperations.lotGet] },
});

export {
  inspectionRequestOperations,
  closedInspectionRequestSchema,
  inspectionOutcomeSchema,
  type ClosedInspectionRequest,
} from './inspection-requests';
export { lotSummarySchema } from './schemas';

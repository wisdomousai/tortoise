import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { mountFeature } from '@agent-native/host/feature';
import type {
  LabRequestsOptions,
  LabRequestsRoot,
} from '@agent-native/pattern-lab-requests/application';
import {
  createLabRequestsHandlers,
  createLabRequestsState,
  labRequestsModule,
  labRequestsPolicy,
  type LabRequestsServices,
} from '@agent-native/pattern-lab-requests/server';
import manifest from './manifest';
import { reviewAccess } from './access';
import { reviewFeature, type ReviewAccess, type ReviewHooks } from './features/review/feature';

/**
 * The lab requests base with the review feature mounted: a technician other than the requester
 * approves or rejects a test request at the revision they read.
 */
export function createLabRequestsReviewApplication(options: LabRequestsOptions = {}) {
  return defineApplication<LabRequestsRoot, LabRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      labRequests: createLabRequestsState(ownerId, options.members),
    }),
    handlers: sliceHandlers<LabRequestsRoot, 'labRequests', LabRequestsServices>(
      'labRequests',
      createLabRequestsHandlers(),
    ),
    authorization: composeAuthorization<LabRequestsRoot>([
      authorizationRoute('labRequests', labRequestsModule, ['test-request'], labRequestsPolicy),
    ]),
    features: [
      // The hooks reuse the application's id and clock services, so tests fix both.
      mountFeature<LabRequestsRoot, ReviewAccess, ReviewHooks, LabRequestsServices>(
        reviewFeature(),
        {
          access: reviewAccess,
          hooks: {
            newId: (ctx) => ctx.services.newId?.() ?? crypto.randomUUID(),
            now: (ctx) => (ctx.services.now ?? Date.now)(),
          },
        },
      ),
    ],
    ...(options.services ? { services: options.services } : {}),
  });
}

export default createLabRequestsReviewApplication();

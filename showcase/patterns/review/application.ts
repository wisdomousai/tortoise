import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { mountFeature } from '@agent-native/host/feature';
import type { TestRequestsOptions, TestRequestsRoot } from '@agent-native/pattern-base/application';
import {
  createTestRequestsHandlers,
  createTestRequestsState,
  testRequestsModule,
  testRequestsPolicy,
  type TestRequestsServices,
} from '@agent-native/pattern-base/server';
import manifest from './manifest';
import { reviewAccess } from './access';
import { reviewFeature, type ReviewAccess, type ReviewHooks } from './features/review/feature';

/**
 * The test requests base with the review feature mounted: a technician other than the requester
 * approves or rejects a test request at the revision they read.
 */
export function createTestRequestsReviewApplication(options: TestRequestsOptions = {}) {
  return defineApplication<TestRequestsRoot, TestRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      testRequests: createTestRequestsState(ownerId, options.members),
    }),
    handlers: sliceHandlers<TestRequestsRoot, 'testRequests', TestRequestsServices>(
      'testRequests',
      createTestRequestsHandlers(),
    ),
    authorization: composeAuthorization<TestRequestsRoot>([
      authorizationRoute('testRequests', testRequestsModule, ['test-request'], testRequestsPolicy),
    ]),
    features: [
      // The hooks reuse the application's id and clock services, so tests fix both.
      mountFeature<TestRequestsRoot, ReviewAccess, ReviewHooks, TestRequestsServices>(
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

export default createTestRequestsReviewApplication();

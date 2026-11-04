import { authorizationRoute, composeAuthorization, sliceHandlers } from '@tortoise/runtime';
import { defineApplication } from '@tortoise/host/application';
import { mountFeature } from '@tortoise/host/feature';
import {
  assignmentFeature,
  type AssignmentAccess,
  type AssignmentHooks,
} from '@tortoise/assignments/server';
import { createPeerLinkPlugin } from '@tortoise/peer-link/plugin';
import {
  createTestRequestsHandlers,
  createTestRequestsState,
  requestOperations,
  testRequestsModule,
  testRequestsPolicy,
  type Role,
  type TestRequestsServices,
} from '@tortoise/pattern-base/server';
import manifest from './manifest';
import { assignmentOperations, assignments, samplingApi } from './contracts';
import type { TestRequestsAssignmentsRoot } from './domain';
import { createSamplingHandlers, samplingHooks } from './handlers';
import { samplingAccess, samplingRoute } from './policy';

export interface TestRequestsAssignmentsOptions {
  members?: Record<string, Role>;
  services?: TestRequestsServices;
}

/**
 * The test requests module unchanged, with sampling rounds as assignments. A technician sends a
 * round at a substation to a member, who reports each sample on `My rounds`, or to a field
 * service contractor's application over the peer link, which takes it into its worklist. A
 * technician accepts each report, which submits a test request for its sample.
 */
export function createTestRequestsAssignmentsApplication(
  options: TestRequestsAssignmentsOptions = {},
) {
  return defineApplication<TestRequestsAssignmentsRoot, TestRequestsServices>({
    manifest,
    createState: (localUserId) => ({
      testRequests: createTestRequestsState(localUserId, options.members),
    }),
    handlers: [
      ...sliceHandlers<TestRequestsAssignmentsRoot, 'testRequests', TestRequestsServices>(
        'testRequests',
        createTestRequestsHandlers(),
      ),
      ...createSamplingHandlers(),
    ],
    authorization: composeAuthorization<TestRequestsAssignmentsRoot>([
      authorizationRoute('testRequests', testRequestsModule, ['test-request'], testRequestsPolicy),
      samplingRoute,
    ]),
    features: [
      mountFeature<
        TestRequestsAssignmentsRoot,
        AssignmentAccess,
        AssignmentHooks,
        TestRequestsServices
      >(assignmentFeature(assignments), { access: samplingAccess, hooks: samplingHooks }),
    ],
    ...(options.services ? { services: options.services } : {}),
    selectableResources: {
      'test-request': requestOperations.requestGet.id,
      assignment: assignmentOperations.get.id,
      'assignment-report': assignmentOperations.reportGet.id,
    },
    plugins: [createPeerLinkPlugin({ api: samplingApi })],
  });
}

export default createTestRequestsAssignmentsApplication();

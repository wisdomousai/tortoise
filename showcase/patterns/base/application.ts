import { authorizationRoute, composeAuthorization, sliceHandlers } from '@tortoise/runtime';
import { defineApplication } from '@tortoise/host/application';
import manifest from './manifest';
import {
  createTestRequestsHandlers,
  createTestRequestsState,
  testRequestsModule,
  testRequestsPolicy,
  type TestRequestsServices,
  type TestRequestsState,
  type Role,
} from './server';

/** Workspace state: one `testRequests` slice, so other modules compose next to it unchanged. */
export interface TestRequestsRoot {
  testRequests: TestRequestsState;
}

export interface TestRequestsOptions {
  /** People who work in a new workspace besides its owner, who is always a technician. */
  members?: Record<string, Role>;
  services?: TestRequestsServices;
}

/** The test requests pattern: one module and its policy, with no plugins. */
export function createTestRequestsApplication(options: TestRequestsOptions = {}) {
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
    ...(options.services ? { services: options.services } : {}),
  });
}

export default createTestRequestsApplication();

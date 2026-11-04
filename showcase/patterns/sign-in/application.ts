import { authorizationRoute, composeAuthorization, sliceHandlers } from '@tortoise/runtime';
import { defineApplication } from '@tortoise/host/application';
import { createStationSignInPlugin } from '@tortoise/workstation-sign-in/plugin';
import {
  createTestRequestsHandlers,
  createTestRequestsState,
  testRequestsModule,
  testRequestsPolicy,
  type TestRequestsServices,
  type TestRequestsState,
  type Role,
} from '@tortoise/pattern-base/server';
import manifest from './manifest';

export interface TestRequestsSignInRoot {
  testRequests: TestRequestsState;
}

/** The people who sign in at the bench: a technician and a viewer from the quality office. */
export const benchMembers: Record<string, Role> = { ana: 'technician', ben: 'viewer' };

export interface TestRequestsSignInOptions {
  /** People who work in a new workspace besides its owner; `benchMembers` by default. */
  members?: Record<string, Role>;
  /** The clock for operator sessions and badge lockouts, for tests. */
  now?: () => number;
}

/**
 * The test requests pattern with workstation sign-in. The owner's screen is the bench terminal and
 * the badge admin. An operator who signs in there acts as themselves under the test requests
 * policy, so a viewer reads requests but cannot submit one.
 */
export function createTestRequestsSignInApplication(options: TestRequestsSignInOptions = {}) {
  return defineApplication<TestRequestsSignInRoot, TestRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      testRequests: createTestRequestsState(ownerId, options.members ?? benchMembers),
    }),
    handlers: sliceHandlers<TestRequestsSignInRoot, 'testRequests', TestRequestsServices>(
      'testRequests',
      createTestRequestsHandlers(),
    ),
    authorization: composeAuthorization<TestRequestsSignInRoot>([
      authorizationRoute('testRequests', testRequestsModule, ['test-request'], testRequestsPolicy),
    ]),
    plugins: [createStationSignInPlugin(options.now ? { now: options.now } : {})],
  });
}

export default createTestRequestsSignInApplication();

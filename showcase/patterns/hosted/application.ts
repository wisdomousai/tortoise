import { authorizationRoute, composeAuthorization, sliceHandlers } from '@tortoise/runtime';
import { defineApplication } from '@tortoise/host/application';
import { networkPlugin } from '@tortoise/network/plugin';
import { deploymentPlugin } from '@tortoise/deployment/plugin';
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

export interface TestRequestsHostedRoot {
  testRequests: TestRequestsState;
}

/**
 * The lab's staff and their roles. Under workforce sign-in the principal is the email the
 * identity provider verified, so the members are keyed by email.
 */
export const labStaff: Readonly<Record<string, Role>> = {
  'ana@lab.example': 'technician',
  'ben@lab.example': 'viewer',
};

/**
 * The test requests pattern as a hosted instance. Nothing here names Postgres: the launch picks the
 * hosted platform (`--hosted-workspace`), and the deployment policy picks external identity.
 */
export function createTestRequestsHostedApplication(
  options: { members?: Record<string, Role> } = {},
) {
  const members = options.members ?? labStaff;
  return defineApplication<TestRequestsHostedRoot, TestRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      testRequests: createTestRequestsState(ownerId, { ...members }),
    }),
    handlers: sliceHandlers<TestRequestsHostedRoot, 'testRequests', TestRequestsServices>(
      'testRequests',
      createTestRequestsHandlers(),
    ),
    authorization: composeAuthorization<TestRequestsHostedRoot>([
      authorizationRoute('testRequests', testRequestsModule, ['test-request'], testRequestsPolicy),
    ]),
    plugins: [deploymentPlugin, networkPlugin],
  });
}

export default createTestRequestsHostedApplication();

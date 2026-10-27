import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { networkPlugin } from '@agent-native/network/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import {
  createLabRequestsHandlers,
  createLabRequestsState,
  labRequestsModule,
  labRequestsPolicy,
  type LabRequestsServices,
  type LabRequestsState,
  type Role,
} from '@agent-native/sample-lab-requests/server';
import manifest from './manifest';

export interface LabRequestsHostedRoot {
  labRequests: LabRequestsState;
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
 * The lab requests sample as a hosted instance. Nothing here names Postgres: the launch picks the
 * hosted platform (`--hosted-workspace`), and the deployment policy picks external identity.
 */
export function createLabRequestsHostedApplication(
  options: { members?: Record<string, Role> } = {},
) {
  const members = options.members ?? labStaff;
  return defineApplication<LabRequestsHostedRoot, LabRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      labRequests: createLabRequestsState(ownerId, { ...members }),
    }),
    handlers: sliceHandlers<LabRequestsHostedRoot, 'labRequests', LabRequestsServices>(
      'labRequests',
      createLabRequestsHandlers(),
    ),
    authorization: composeAuthorization<LabRequestsHostedRoot>([
      authorizationRoute('labRequests', labRequestsModule, ['test-request'], labRequestsPolicy),
    ]),
    plugins: [sitePlugin, networkPlugin],
  });
}

export default createLabRequestsHostedApplication();

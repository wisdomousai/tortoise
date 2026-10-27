import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { createStationSignInPlugin } from '@agent-native/workstation-sign-in/plugin';
import {
  createLabRequestsHandlers,
  createLabRequestsState,
  labRequestsModule,
  labRequestsPolicy,
  type LabRequestsServices,
  type LabRequestsState,
  type Role,
} from '@agent-native/pattern-lab-requests/server';
import manifest from './manifest';

export interface LabRequestsSignInRoot {
  labRequests: LabRequestsState;
}

/** The people who sign in at the bench: a technician and a viewer from the quality office. */
export const benchMembers: Record<string, Role> = { ana: 'technician', ben: 'viewer' };

export interface LabRequestsSignInOptions {
  /** People who work in a new workspace besides its owner; `benchMembers` by default. */
  members?: Record<string, Role>;
  /** The clock for operator sessions and badge lockouts, for tests. */
  now?: () => number;
}

/**
 * The lab requests pattern with workstation sign-in. The owner's screen is the bench terminal and
 * the badge admin. An operator who signs in there acts as themselves under the lab requests
 * policy, so a viewer reads requests but cannot submit one.
 */
export function createLabRequestsSignInApplication(options: LabRequestsSignInOptions = {}) {
  return defineApplication<LabRequestsSignInRoot, LabRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      labRequests: createLabRequestsState(ownerId, options.members ?? benchMembers),
    }),
    handlers: sliceHandlers<LabRequestsSignInRoot, 'labRequests', LabRequestsServices>(
      'labRequests',
      createLabRequestsHandlers(),
    ),
    authorization: composeAuthorization<LabRequestsSignInRoot>([
      authorizationRoute('labRequests', labRequestsModule, ['test-request'], labRequestsPolicy),
    ]),
    plugins: [createStationSignInPlugin(options.now ? { now: options.now } : {})],
  });
}

export default createLabRequestsSignInApplication();

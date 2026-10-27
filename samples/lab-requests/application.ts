import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import manifest from './manifest';
import {
  createLabRequestsHandlers,
  createLabRequestsState,
  labRequestsModule,
  labRequestsPolicy,
  type LabRequestsServices,
  type LabRequestsState,
  type Role,
} from './server';

/** Workspace state: one `labRequests` slice, so other modules compose next to it unchanged. */
export interface LabRequestsRoot {
  labRequests: LabRequestsState;
}

export interface LabRequestsOptions {
  /** People who work in a new workspace besides its owner, who is always a technician. */
  members?: Record<string, Role>;
  services?: LabRequestsServices;
}

/** The lab requests sample: one module and its policy, with no plugins. */
export function createLabRequestsApplication(options: LabRequestsOptions = {}) {
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
    ...(options.services ? { services: options.services } : {}),
  });
}

export default createLabRequestsApplication();

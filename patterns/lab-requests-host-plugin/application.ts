import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import type { LabRequestsRoot } from '@agent-native/pattern-lab-requests/application';
import {
  createLabRequestsHandlers,
  createLabRequestsState,
  labRequestsModule,
  labRequestsPolicy,
  type LabRequestsServices,
  type Role,
} from '@agent-native/pattern-lab-requests/server';
import manifest from './manifest';
import { createActivityPlugin } from './plugins/activity/plugin';

export interface LabRequestsHostPluginOptions {
  members?: Record<string, Role>;
  services?: LabRequestsServices;
  /** Between counting passes; one second when omitted. */
  activityIntervalMs?: number;
}

/**
 * The lab requests module unchanged, with the activity plugin. The plugin brings its own state
 * slice, handlers and policy; the application lists it here, in the manifest and in the screens.
 */
export function createLabRequestsHostPluginApplication(options: LabRequestsHostPluginOptions = {}) {
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
    plugins: [
      createActivityPlugin(
        options.activityIntervalMs ? { intervalMs: options.activityIntervalMs } : {},
      ),
    ],
  });
}

export default createLabRequestsHostPluginApplication();

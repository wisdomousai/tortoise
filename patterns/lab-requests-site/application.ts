import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { auditPlugin } from '@agent-native/audit/plugin';
import { createFleetAgentPlugin } from '@agent-native/fleet-agent/plugin';
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
} from '@agent-native/pattern-lab-requests/server';
import manifest from './manifest';

export interface LabRequestsSiteRoot {
  labRequests: LabRequestsState;
}

export interface LabRequestsSiteOptions {
  /** People who work in a new workspace besides its owner, with their roles. */
  members?: Record<string, Role>;
  /** Between fleet cycles; one minute by default. Tests run cycles with the agent's `sync()`. */
  intervalMs?: number;
}

/**
 * The lab requests pattern as a site instance. The deployment policy binds the `fleet`
 * destination and the `fleet-releases` folder. The fleet agent then reports the site's outbox,
 * forwards its audit log and stages the releases the fleet assigns, all outbound through the
 * network guard. Without those bindings the site runs on its own.
 */
export function createLabRequestsSiteApplication(options: LabRequestsSiteOptions = {}) {
  return defineApplication<LabRequestsSiteRoot, LabRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      labRequests: createLabRequestsState(ownerId, options.members),
    }),
    handlers: sliceHandlers<LabRequestsSiteRoot, 'labRequests', LabRequestsServices>(
      'labRequests',
      createLabRequestsHandlers(),
    ),
    authorization: composeAuthorization<LabRequestsSiteRoot>([
      authorizationRoute('labRequests', labRequestsModule, ['test-request'], labRequestsPolicy),
    ]),
    plugins: [
      sitePlugin,
      networkPlugin,
      auditPlugin,
      createFleetAgentPlugin(options.intervalMs ? { intervalMs: options.intervalMs } : {}),
    ],
  });
}

export default createLabRequestsSiteApplication();

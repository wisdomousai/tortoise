import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { auditPlugin } from '@agent-native/audit/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import {
  createLabRequestsHandlers,
  createLabRequestsState,
  labRequestsModule,
  labRequestsPolicy,
  type LabRequestsServices,
  type Role,
} from '@agent-native/sample-lab-requests/server';
import manifest from './manifest';
import {
  createChambersState,
  defaultChambers,
  type ChamberDefinition,
  type LabSignalsRoot,
} from './domain';
import { createChamberHandlers } from './handlers';
import { createChamberObservers } from './observers';
import { chamberRoute } from './policy';

export interface LabRequestsSignalsOptions {
  members?: Record<string, Role>;
  services?: LabRequestsServices;
  chambers?: readonly ChamberDefinition[];
  /** Between observation passes; two seconds when omitted. */
  observeMs?: number;
}

/**
 * The lab requests module unchanged, with climate chamber conditions read from the plant: chamber
 * temperature over OPC UA and humidity from Sparkplug B edge nodes. Both sources are declared in
 * the manifest and bound by the site policy; until they are bound, the observers report errors
 * and no reading arrives.
 */
export function createLabRequestsSignalsApplication(options: LabRequestsSignalsOptions = {}) {
  const chambers = options.chambers ?? defaultChambers;
  return defineApplication<LabSignalsRoot, LabRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      labRequests: createLabRequestsState(ownerId, options.members),
      chambers: createChambersState(),
    }),
    handlers: [
      ...sliceHandlers<LabSignalsRoot, 'labRequests', LabRequestsServices>(
        'labRequests',
        createLabRequestsHandlers(),
      ),
      ...createChamberHandlers(chambers),
    ],
    authorization: composeAuthorization<LabSignalsRoot>([
      authorizationRoute('labRequests', labRequestsModule, ['test-request'], labRequestsPolicy),
      chamberRoute,
    ]),
    ...(options.services ? { services: options.services } : {}),
    plugins: [sitePlugin, networkPlugin, auditPlugin],
    connect: ({ application, workspaceId, network }) => ({
      observe: async (onError) => {
        const observers = createChamberObservers({ application, workspaceId, network, chambers });
        observers.start(options.observeMs ?? 2_000, onError);
        return [observers];
      },
    }),
  });
}

export default createLabRequestsSignalsApplication();

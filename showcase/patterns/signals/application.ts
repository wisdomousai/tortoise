import { authorizationRoute, composeAuthorization, sliceHandlers } from '@tortoise/runtime';
import { defineApplication } from '@tortoise/host/application';
import { auditPlugin } from '@tortoise/audit/plugin';
import { networkPlugin } from '@tortoise/network/plugin';
import { deploymentPlugin } from '@tortoise/deployment/plugin';
import {
  createTestRequestsHandlers,
  createTestRequestsState,
  testRequestsModule,
  testRequestsPolicy,
  type TestRequestsServices,
  type Role,
} from '@tortoise/pattern-base/server';
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

export interface TestRequestsSignalsOptions {
  members?: Record<string, Role>;
  services?: TestRequestsServices;
  chambers?: readonly ChamberDefinition[];
  /** Between observation passes; two seconds when omitted. */
  observeMs?: number;
}

/**
 * The test requests module unchanged, with climate chamber conditions read from the plant: chamber
 * temperature over OPC UA and humidity from Sparkplug B edge nodes. Both sources are declared in
 * the manifest and bound by the deployment policy; until they are bound, the observers report errors
 * and no reading is received.
 */
export function createTestRequestsSignalsApplication(options: TestRequestsSignalsOptions = {}) {
  const chambers = options.chambers ?? defaultChambers;
  return defineApplication<LabSignalsRoot, TestRequestsServices>({
    manifest,
    createState: (localUserId) => ({
      testRequests: createTestRequestsState(localUserId, options.members),
      chambers: createChambersState(),
    }),
    handlers: [
      ...sliceHandlers<LabSignalsRoot, 'testRequests', TestRequestsServices>(
        'testRequests',
        createTestRequestsHandlers(),
      ),
      ...createChamberHandlers(chambers),
    ],
    authorization: composeAuthorization<LabSignalsRoot>([
      authorizationRoute('testRequests', testRequestsModule, ['test-request'], testRequestsPolicy),
      chamberRoute,
    ]),
    ...(options.services ? { services: options.services } : {}),
    plugins: [deploymentPlugin, networkPlugin, auditPlugin],
    connect: ({ application, workspaceId, network }) => ({
      observe: async (onError) => {
        const observers = createChamberObservers({ application, workspaceId, network, chambers });
        observers.start(options.observeMs ?? 2_000, onError);
        return [observers];
      },
    }),
  });
}

export default createTestRequestsSignalsApplication();

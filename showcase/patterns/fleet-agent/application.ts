import { authorizationRoute, composeAuthorization, sliceHandlers } from '@tortoise/runtime';
import { defineApplication } from '@tortoise/host/application';
import { auditPlugin } from '@tortoise/audit/plugin';
import { createFleetAgentPlugin } from '@tortoise/fleet-agent/plugin';
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

export interface TestRequestsFleetAgentRoot {
  testRequests: TestRequestsState;
}

export interface TestRequestsFleetAgentOptions {
  /** People who work in a new workspace besides its owner, with their roles. */
  members?: Record<string, Role>;
  /** Between fleet cycles; one minute by default. Tests run cycles with the agent's `sync()`. */
  intervalMs?: number;
}

/**
 * The test requests pattern as a lab instance. The deployment policy binds the `fleet`
 * destination and the `fleet-releases` folder. The fleet agent then reports the instance's outbox,
 * forwards its audit log and stages the releases the fleet assigns, all outbound through the
 * network guard. Without those bindings the instance runs on its own.
 */
export function createTestRequestsFleetAgentApplication(
  options: TestRequestsFleetAgentOptions = {},
) {
  return defineApplication<TestRequestsFleetAgentRoot, TestRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      testRequests: createTestRequestsState(ownerId, options.members),
    }),
    handlers: sliceHandlers<TestRequestsFleetAgentRoot, 'testRequests', TestRequestsServices>(
      'testRequests',
      createTestRequestsHandlers(),
    ),
    authorization: composeAuthorization<TestRequestsFleetAgentRoot>([
      authorizationRoute('testRequests', testRequestsModule, ['test-request'], testRequestsPolicy),
    ]),
    plugins: [
      deploymentPlugin,
      networkPlugin,
      auditPlugin,
      createFleetAgentPlugin(options.intervalMs ? { intervalMs: options.intervalMs } : {}),
    ],
  });
}

export default createTestRequestsFleetAgentApplication();

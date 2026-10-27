import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { auditPlugin } from '@agent-native/audit/plugin';
import { createFleetAgentPlugin } from '@agent-native/fleet-agent/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import {
  createTestRequestsHandlers,
  createTestRequestsState,
  testRequestsModule,
  testRequestsPolicy,
  type TestRequestsServices,
  type TestRequestsState,
  type Role,
} from '@agent-native/pattern-base/server';
import manifest from './manifest';

export interface TestRequestsSiteRoot {
  testRequests: TestRequestsState;
}

export interface TestRequestsSiteOptions {
  /** People who work in a new workspace besides its owner, with their roles. */
  members?: Record<string, Role>;
  /** Between fleet cycles; one minute by default. Tests run cycles with the agent's `sync()`. */
  intervalMs?: number;
}

/**
 * The test requests pattern as a site instance. The deployment policy binds the `fleet`
 * destination and the `fleet-releases` folder. The fleet agent then reports the site's outbox,
 * forwards its audit log and stages the releases the fleet assigns, all outbound through the
 * network guard. Without those bindings the site runs on its own.
 */
export function createTestRequestsSiteApplication(options: TestRequestsSiteOptions = {}) {
  return defineApplication<TestRequestsSiteRoot, TestRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      testRequests: createTestRequestsState(ownerId, options.members),
    }),
    handlers: sliceHandlers<TestRequestsSiteRoot, 'testRequests', TestRequestsServices>(
      'testRequests',
      createTestRequestsHandlers(),
    ),
    authorization: composeAuthorization<TestRequestsSiteRoot>([
      authorizationRoute('testRequests', testRequestsModule, ['test-request'], testRequestsPolicy),
    ]),
    plugins: [
      sitePlugin,
      networkPlugin,
      auditPlugin,
      createFleetAgentPlugin(options.intervalMs ? { intervalMs: options.intervalMs } : {}),
    ],
  });
}

export default createTestRequestsSiteApplication();

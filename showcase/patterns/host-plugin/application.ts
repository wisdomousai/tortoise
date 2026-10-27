import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import type { TestRequestsRoot } from '@agent-native/pattern-base/application';
import {
  createTestRequestsHandlers,
  createTestRequestsState,
  testRequestsModule,
  testRequestsPolicy,
  type TestRequestsServices,
  type Role,
} from '@agent-native/pattern-base/server';
import manifest from './manifest';
import { createActivityPlugin } from './plugins/activity/plugin';

export interface TestRequestsHostPluginOptions {
  members?: Record<string, Role>;
  services?: TestRequestsServices;
  /** Between counting passes; one second when omitted. */
  activityIntervalMs?: number;
}

/**
 * The test requests module unchanged, with the activity plugin. The plugin brings its own state
 * slice, handlers and policy; the application lists it here, in the manifest and in the screens.
 */
export function createTestRequestsHostPluginApplication(
  options: TestRequestsHostPluginOptions = {},
) {
  return defineApplication<TestRequestsRoot, TestRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      testRequests: createTestRequestsState(ownerId, options.members),
    }),
    handlers: sliceHandlers<TestRequestsRoot, 'testRequests', TestRequestsServices>(
      'testRequests',
      createTestRequestsHandlers(),
    ),
    authorization: composeAuthorization<TestRequestsRoot>([
      authorizationRoute('testRequests', testRequestsModule, ['test-request'], testRequestsPolicy),
    ]),
    ...(options.services ? { services: options.services } : {}),
    plugins: [
      createActivityPlugin(
        options.activityIntervalMs ? { intervalMs: options.activityIntervalMs } : {},
      ),
    ],
  });
}

export default createTestRequestsHostPluginApplication();

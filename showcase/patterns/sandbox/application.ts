import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { createExecutionHostPlugin } from '@agent-native/execution-host/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { processPlugin } from '@agent-native/process/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import {
  createTestRequestsHandlers,
  createTestRequestsState,
  testRequestsModule,
  testRequestsPolicy,
  type TestRequestsServices,
  type Role,
} from '@agent-native/pattern-base/server';
import manifest from './manifest';
import type { TestRequestsSandboxRoot } from './domain';
import { createResultHandlers } from './handlers';
import { resultsRoute } from './policy';
import { resultAnalysisPlugin } from './plugins/result-analysis/plugin';

export interface TestRequestsSandboxOptions {
  members?: Record<string, Role>;
  services?: TestRequestsServices;
}

/**
 * The test requests module unchanged, with test results in their own slice. The execution host
 * mounts one tool, this Bun, so the analysis tool and the CLI it calls are the only programs in
 * the sandbox. On a platform without bubblewrap the plugin still opens and reports the sandbox
 * unavailable.
 */
export function createTestRequestsSandboxApplication(options: TestRequestsSandboxOptions = {}) {
  return defineApplication<TestRequestsSandboxRoot, TestRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      testRequests: createTestRequestsState(ownerId, options.members),
      testResults: { results: {} },
    }),
    handlers: [
      ...sliceHandlers<TestRequestsSandboxRoot, 'testRequests', TestRequestsServices>(
        'testRequests',
        createTestRequestsHandlers(),
      ),
      ...createResultHandlers(),
    ],
    authorization: composeAuthorization<TestRequestsSandboxRoot>([
      authorizationRoute('testRequests', testRequestsModule, ['test-request'], testRequestsPolicy),
      resultsRoute,
    ]),
    ...(options.services ? { services: options.services } : {}),
    plugins: [
      sitePlugin,
      networkPlugin,
      processPlugin,
      createExecutionHostPlugin({ tools: { bun: process.execPath } }),
      resultAnalysisPlugin,
    ],
  });
}

export default createTestRequestsSandboxApplication();

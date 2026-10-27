import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { createExecutionHostPlugin } from '@agent-native/execution-host/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { processPlugin } from '@agent-native/process/plugin';
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
import type { LabRequestsSandboxRoot } from './domain';
import { createResultHandlers } from './handlers';
import { resultsRoute } from './policy';
import { resultAnalysisPlugin } from './plugins/result-analysis/plugin';

export interface LabRequestsSandboxOptions {
  members?: Record<string, Role>;
  services?: LabRequestsServices;
}

/**
 * The lab requests module unchanged, with test results in their own slice. The execution host
 * mounts one tool, this Bun, so the analysis tool and the CLI it calls are the only programs in
 * the sandbox. On a platform without bubblewrap the plugin still opens and reports the sandbox
 * unavailable.
 */
export function createLabRequestsSandboxApplication(options: LabRequestsSandboxOptions = {}) {
  return defineApplication<LabRequestsSandboxRoot, LabRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      labRequests: createLabRequestsState(ownerId, options.members),
      testResults: { results: {} },
    }),
    handlers: [
      ...sliceHandlers<LabRequestsSandboxRoot, 'labRequests', LabRequestsServices>(
        'labRequests',
        createLabRequestsHandlers(),
      ),
      ...createResultHandlers(),
    ],
    authorization: composeAuthorization<LabRequestsSandboxRoot>([
      authorizationRoute('labRequests', labRequestsModule, ['test-request'], labRequestsPolicy),
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

export default createLabRequestsSandboxApplication();

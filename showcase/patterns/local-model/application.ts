import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { approvalOperations } from '@agent-native/contracts';
import { auditPlugin } from '@agent-native/audit/plugin';
import { createAutomationPlugin } from '@agent-native/automation/plugin';
import { defineApplication } from '@agent-native/host/application';
import { createModelServer } from '@agent-native/model-server/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { processPlugin } from '@agent-native/process/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import {
  createTestRequestsHandlers,
  createTestRequestsState,
  testRequestsModule,
  testRequestsPolicy,
  requestOperations,
  type TestRequestsServices,
  type Role,
} from '@agent-native/pattern-base/server';
import manifest from './manifest';
import { suggestMethodsOnLocalModel } from './automation';
import type { TestRequestsLocalModelRoot } from './domain';
import { createSuggestionHandlers } from './handlers';
import { methodModelFrom, type MethodModel } from './model';
import { suggestionsRoute } from './policy';

export interface TestRequestsLocalModelOptions {
  members?: Record<string, Role>;
  services?: TestRequestsServices;
  /** The entry, files and activation to serve; `methodModelFrom()` when omitted. */
  model?: MethodModel;
  /** Serve the model only to `evaluationHarness`, so the gate can judge a fine-tune. */
  evaluation?: boolean;
  /** Between trigger loop passes; the automation plugin's default when omitted. */
  automationIntervalMs?: number;
  /** How often the model server polls the model list while it starts. */
  pollMs?: number;
}

/**
 * The test requests module unchanged, with approval requests, the method suggester and a trigger
 * that runs it on each new request. The model server plugin measures the weights against the
 * `lab-methods` entry and starts llama-server through the process port; the trigger's runs use
 * its harness and record the measured digests.
 */
export function composeTestRequestsLocalModel(options: TestRequestsLocalModelOptions = {}) {
  const model = options.model ?? methodModelFrom();
  const models = createModelServer({
    process: 'llm',
    runtime: 'llama-server',
    entry: model.entry,
    files: model.files,
    ...(model.activation ? { activation: model.activation } : {}),
    ...(options.evaluation ? { evaluation: true } : {}),
    ...(options.pollMs ? { pollMs: options.pollMs } : {}),
  });
  const application = defineApplication<TestRequestsLocalModelRoot, TestRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      testRequests: createTestRequestsState(ownerId, options.members),
      suggestions: { approvals: {} },
    }),
    handlers: [
      ...sliceHandlers<TestRequestsLocalModelRoot, 'testRequests', TestRequestsServices>(
        'testRequests',
        createTestRequestsHandlers(),
      ),
      ...createSuggestionHandlers(),
    ],
    authorization: composeAuthorization<TestRequestsLocalModelRoot>([
      authorizationRoute('testRequests', testRequestsModule, ['test-request'], testRequestsPolicy),
      suggestionsRoute,
    ]),
    ...(options.services ? { services: options.services } : {}),
    selectableResources: {
      'test-request': requestOperations.requestGet.id,
      'approval-request': approvalOperations.approvalGet.id,
    },
    plugins: [
      sitePlugin,
      networkPlugin,
      processPlugin,
      auditPlugin,
      models.plugin,
      createAutomationPlugin({
        triggers: [suggestMethodsOnLocalModel],
        agentHarnesses: [models.harness],
        ...(options.automationIntervalMs ? { intervalMs: options.automationIntervalMs } : {}),
      }),
    ],
  });
  return { application, models };
}

export const createTestRequestsLocalModelApplication = (
  options: TestRequestsLocalModelOptions = {},
) => composeTestRequestsLocalModel(options).application;

export default createTestRequestsLocalModelApplication();

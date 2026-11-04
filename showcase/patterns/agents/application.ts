import { authorizationRoute, composeAuthorization, sliceHandlers } from '@tortoise/runtime';
import { defineApplication } from '@tortoise/host/application';
import {
  createTestRequestsHandlers,
  createTestRequestsState,
  testRequestsModule,
  testRequestsPolicy,
  requestOperations,
  type TestRequestsServices,
  type Role,
} from '@tortoise/pattern-base/server';
import { approvalOperations } from '@tortoise/contracts';
import manifest from './manifest';
import { createMethodAutomation } from './automation';
import type { TestRequestsAgentsRoot } from './domain';
import { createSuggestionHandlers } from './handlers';
import { suggestionsRoute } from './policy';

export interface TestRequestsAgentsOptions {
  members?: Record<string, Role>;
  services?: TestRequestsServices;
  /** Between trigger loop passes; the automation plugin's default when omitted. */
  automationIntervalMs?: number;
}

/**
 * The test requests module unchanged, with approval requests in their own slice, the method
 * suggester agent and a trigger. A run started from the request screen captures the open test
 * request, because `test-request` is a selectable resource, and can send intents back to that
 * screen.
 */
export function createTestRequestsAgentsApplication(options: TestRequestsAgentsOptions = {}) {
  return defineApplication<TestRequestsAgentsRoot, TestRequestsServices>({
    manifest,
    createState: (localUserId) => ({
      testRequests: createTestRequestsState(localUserId, options.members),
      suggestions: { approvals: {} },
    }),
    handlers: [
      ...sliceHandlers<TestRequestsAgentsRoot, 'testRequests', TestRequestsServices>(
        'testRequests',
        createTestRequestsHandlers(),
      ),
      ...createSuggestionHandlers(),
    ],
    authorization: composeAuthorization<TestRequestsAgentsRoot>([
      authorizationRoute('testRequests', testRequestsModule, ['test-request'], testRequestsPolicy),
      suggestionsRoute,
    ]),
    ...(options.services ? { services: options.services } : {}),
    selectableResources: {
      'test-request': requestOperations.requestGet.id,
      'approval-request': approvalOperations.approvalGet.id,
    },
    plugins: [
      createMethodAutomation(
        options.automationIntervalMs ? { intervalMs: options.automationIntervalMs } : {},
      ),
    ],
  });
}

export default createTestRequestsAgentsApplication();

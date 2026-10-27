import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import {
  createLabRequestsHandlers,
  createLabRequestsState,
  labRequestsModule,
  labRequestsPolicy,
  requestOperations,
  type LabRequestsServices,
  type Role,
} from '@agent-native/sample-lab-requests/server';
import { approvalOperations } from '@agent-native/contracts';
import manifest from './manifest';
import { createMethodAutomation } from './automation';
import type { LabRequestsAgentsRoot } from './domain';
import { createSuggestionHandlers } from './handlers';
import { suggestionsRoute } from './policy';

export interface LabRequestsAgentsOptions {
  members?: Record<string, Role>;
  services?: LabRequestsServices;
  /** Between trigger loop passes; the automation plugin's default when omitted. */
  automationIntervalMs?: number;
}

/**
 * The lab requests module unchanged, with approval requests in their own slice, the method
 * suggester agent and a trigger. A run started from the request screen captures the open test
 * request, because `test-request` is a selectable resource, and can send intents back to that
 * screen.
 */
export function createLabRequestsAgentsApplication(options: LabRequestsAgentsOptions = {}) {
  return defineApplication<LabRequestsAgentsRoot, LabRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      labRequests: createLabRequestsState(ownerId, options.members),
      suggestions: { approvals: {} },
    }),
    handlers: [
      ...sliceHandlers<LabRequestsAgentsRoot, 'labRequests', LabRequestsServices>(
        'labRequests',
        createLabRequestsHandlers(),
      ),
      ...createSuggestionHandlers(),
    ],
    authorization: composeAuthorization<LabRequestsAgentsRoot>([
      authorizationRoute('labRequests', labRequestsModule, ['test-request'], labRequestsPolicy),
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

export default createLabRequestsAgentsApplication();

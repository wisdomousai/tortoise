import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { auditPlugin } from '@agent-native/audit/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import {
  connectWorklist,
  createWorklistSlice,
  worklistHandlers,
} from '@agent-native/assignments/server';
import { createPeerLinkPlugin, peerLinkServiceOf } from '@agent-native/peer-link/plugin';
import {
  createTestRequestsHandlers,
  createTestRequestsState,
  testRequestsModule,
  testRequestsPolicy,
  type Role,
  type TestRequestsServices,
} from '@agent-native/pattern-base/server';
import manifest from './manifest';
import { worklist } from './contracts';
import { INTEGRATION_PRINCIPAL, type TestRequestsWorklistRoot } from './domain';
import { worklistRoute } from './policy';

export interface TestRequestsWorklistOptions {
  members?: Record<string, Role>;
  services?: TestRequestsServices;
}

/**
 * A field service crew that draws oil samples for the lab: the test requests module unchanged,
 * with a worklist of the sampling rounds the oil lab sends here. The owner connects to the oil
 * lab on the peers screen with a code its owner created. Rounds arrive through inbound sync;
 * samples and done marks leave through the outbox, and each shows whether the oil lab took it.
 */
export function createTestRequestsWorklistApplication(options: TestRequestsWorklistOptions = {}) {
  return defineApplication<TestRequestsWorklistRoot, TestRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      testRequests: createTestRequestsState(ownerId, options.members),
      worklist: createWorklistSlice(),
    }),
    handlers: [
      ...sliceHandlers<TestRequestsWorklistRoot, 'testRequests', TestRequestsServices>(
        'testRequests',
        createTestRequestsHandlers(),
      ),
      ...worklistHandlers<
        TestRequestsWorklistRoot,
        TestRequestsServices,
        (typeof worklist.kinds)[number]
      >(worklist, {
        slice: (state) => state.worklist,
        newId: (ctx) => (ctx.services.newId ?? (() => crypto.randomUUID()))(),
        now: (ctx) => (ctx.services.now ?? Date.now)(),
      }),
    ],
    authorization: composeAuthorization<TestRequestsWorklistRoot>([
      authorizationRoute('testRequests', testRequestsModule, ['test-request'], testRequestsPolicy),
      worklistRoute,
    ]),
    ...(options.services ? { services: options.services } : {}),
    plugins: [
      sitePlugin,
      networkPlugin,
      auditPlugin,
      createPeerLinkPlugin({ targets: [worklist.target] }),
    ],
    connect: ({ application, workspaceId, services }) => ({
      integrations: [
        connectWorklist(worklist, {
          application,
          workspaceId,
          principalId: INTEGRATION_PRINCIPAL,
          client: () => peerLinkServiceOf(services)!.link(worklist.target.target).client(),
          reconnect: {
            missing: 'connect it on the peers screen',
            refused: 'connect it again on the peers screen',
          },
        }),
      ],
    }),
  });
}

export default createTestRequestsWorklistApplication();

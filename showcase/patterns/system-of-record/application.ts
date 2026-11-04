import { authorizationRoute, composeAuthorization, sliceHandlers } from '@tortoise/runtime';
import { connectTarget, type SystemOfRecordPort } from '@tortoise/integration';
import { defineApplication } from '@tortoise/host/application';
import type { NetworkPort } from '@tortoise/host/plugin';
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
import { limsTarget, type RegisteredRequest } from './contracts';
import { LIMS_PRINCIPAL, type LabPublishingRoot } from './domain';
import { createPublishingHandlers } from './handlers';
import { limsPort } from './lims-port';
import { publishingRoute } from './policy';

export interface TestRequestsSystemOfRecordOptions {
  members?: Record<string, Role>;
  services?: TestRequestsServices;
  /** The connector; the LIMS REST API through the network port when omitted. */
  port?: (network: NetworkPort) => SystemOfRecordPort<RegisteredRequest>;
}

/**
 * The test requests module unchanged, with publishing to an enterprise LIMS. The LIMS's
 * destination is declared in the manifest and bound by the deployment policy; until it is bound,
 * publications wait in the outbox.
 */
export function createTestRequestsSystemOfRecordApplication(
  options: TestRequestsSystemOfRecordOptions = {},
) {
  return defineApplication<LabPublishingRoot, TestRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      testRequests: createTestRequestsState(ownerId, options.members),
      publishing: { publications: {}, sync: {} },
    }),
    handlers: [
      ...sliceHandlers<LabPublishingRoot, 'testRequests', TestRequestsServices>(
        'testRequests',
        createTestRequestsHandlers(),
      ),
      ...createPublishingHandlers(),
    ],
    authorization: composeAuthorization<LabPublishingRoot>([
      authorizationRoute('testRequests', testRequestsModule, ['test-request'], testRequestsPolicy),
      publishingRoute,
    ]),
    ...(options.services ? { services: options.services } : {}),
    plugins: [deploymentPlugin, networkPlugin, auditPlugin],
    connect: ({ application, workspaceId, network }) => ({
      integrations: [
        connectTarget<RegisteredRequest>({
          target: limsTarget,
          application,
          port: (options.port ?? limsPort)(network),
          workspaceId,
          principalId: LIMS_PRINCIPAL,
        }),
      ],
    }),
  });
}

export default createTestRequestsSystemOfRecordApplication();

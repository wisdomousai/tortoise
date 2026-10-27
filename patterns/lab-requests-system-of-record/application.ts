import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { connectTarget, type SystemOfRecordPort } from '@agent-native/integration';
import { defineApplication } from '@agent-native/host/application';
import type { NetworkPort } from '@agent-native/host/plugin';
import { auditPlugin } from '@agent-native/audit/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import {
  createLabRequestsHandlers,
  createLabRequestsState,
  labRequestsModule,
  labRequestsPolicy,
  type LabRequestsServices,
  type Role,
} from '@agent-native/pattern-lab-requests/server';
import manifest from './manifest';
import { limsTarget, type RegisteredRequest } from './contracts';
import { LIMS_PRINCIPAL, type LabPublishingRoot } from './domain';
import { createPublishingHandlers } from './handlers';
import { limsPort } from './lims-port';
import { publishingRoute } from './policy';

export interface LabRequestsSystemOfRecordOptions {
  members?: Record<string, Role>;
  services?: LabRequestsServices;
  /** The connector; the LIMS REST API through the network port when omitted. */
  port?: (network: NetworkPort) => SystemOfRecordPort<RegisteredRequest>;
}

/**
 * The lab requests module unchanged, with publishing to an enterprise LIMS. The LIMS's
 * destination is declared in the manifest and bound by the site policy; until it is bound,
 * publications wait in the outbox.
 */
export function createLabRequestsSystemOfRecordApplication(
  options: LabRequestsSystemOfRecordOptions = {},
) {
  return defineApplication<LabPublishingRoot, LabRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      labRequests: createLabRequestsState(ownerId, options.members),
      publishing: { publications: {}, sync: {} },
    }),
    handlers: [
      ...sliceHandlers<LabPublishingRoot, 'labRequests', LabRequestsServices>(
        'labRequests',
        createLabRequestsHandlers(),
      ),
      ...createPublishingHandlers(),
    ],
    authorization: composeAuthorization<LabPublishingRoot>([
      authorizationRoute('labRequests', labRequestsModule, ['test-request'], labRequestsPolicy),
      publishingRoute,
    ]),
    ...(options.services ? { services: options.services } : {}),
    plugins: [sitePlugin, networkPlugin, auditPlugin],
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

export default createLabRequestsSystemOfRecordApplication();

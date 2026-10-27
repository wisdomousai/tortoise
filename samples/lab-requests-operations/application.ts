import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { auditPlugin } from '@agent-native/audit/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import { createTelemetryPlugin } from '@agent-native/telemetry/plugin';
import type { LabRequestsRoot } from '@agent-native/sample-lab-requests/application';
import {
  createLabRequestsHandlers,
  createLabRequestsState,
  labRequestsModule,
  labRequestsPolicy,
  type LabRequestsServices,
  type Role,
} from '@agent-native/sample-lab-requests/server';
import manifest from './manifest';
import { labRequestsMigrations } from './migrations';

export interface LabRequestsOperationsOptions {
  members?: Record<string, Role>;
  services?: LabRequestsServices;
  /** Between telemetry exports; one minute when omitted. */
  telemetryIntervalMs?: number;
}

/**
 * The lab requests module unchanged, at state version 2, with the plugins that run it on a site:
 * the deployment policy (site), the egress guard (network), the audit log and the OpenTelemetry
 * exporter. The plugins add no capabilities the screens need.
 */
export function createLabRequestsOperationsApplication(options: LabRequestsOperationsOptions = {}) {
  return defineApplication<LabRequestsRoot, LabRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      labRequests: createLabRequestsState(ownerId, options.members),
    }),
    migrations: labRequestsMigrations,
    handlers: sliceHandlers<LabRequestsRoot, 'labRequests', LabRequestsServices>(
      'labRequests',
      createLabRequestsHandlers(),
    ),
    authorization: composeAuthorization<LabRequestsRoot>([
      authorizationRoute('labRequests', labRequestsModule, ['test-request'], labRequestsPolicy),
    ]),
    ...(options.services ? { services: options.services } : {}),
    plugins: [
      sitePlugin,
      networkPlugin,
      auditPlugin,
      createTelemetryPlugin(
        options.telemetryIntervalMs ? { intervalMs: options.telemetryIntervalMs } : {},
      ),
    ],
  });
}

export default createLabRequestsOperationsApplication();

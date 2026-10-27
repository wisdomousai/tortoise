import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { auditPlugin } from '@agent-native/audit/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import { createTelemetryPlugin } from '@agent-native/telemetry/plugin';
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
import { testRequestsMigrations } from './migrations';

export interface TestRequestsOperationsOptions {
  members?: Record<string, Role>;
  services?: TestRequestsServices;
  /** Between telemetry exports; one minute when omitted. */
  telemetryIntervalMs?: number;
}

/**
 * The test requests module unchanged, at state version 2, with the plugins that run it on a site:
 * the deployment policy (site), the egress guard (network), the audit log and the OpenTelemetry
 * exporter. The plugins add no capabilities the screens need.
 */
export function createTestRequestsOperationsApplication(
  options: TestRequestsOperationsOptions = {},
) {
  return defineApplication<TestRequestsRoot, TestRequestsServices>({
    manifest,
    createState: (ownerId) => ({
      testRequests: createTestRequestsState(ownerId, options.members),
    }),
    migrations: testRequestsMigrations,
    handlers: sliceHandlers<TestRequestsRoot, 'testRequests', TestRequestsServices>(
      'testRequests',
      createTestRequestsHandlers(),
    ),
    authorization: composeAuthorization<TestRequestsRoot>([
      authorizationRoute('testRequests', testRequestsModule, ['test-request'], testRequestsPolicy),
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

export default createTestRequestsOperationsApplication();

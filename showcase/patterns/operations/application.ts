import { authorizationRoute, composeAuthorization, sliceHandlers } from '@tortoise/runtime';
import { defineApplication } from '@tortoise/host/application';
import { auditPlugin } from '@tortoise/audit/plugin';
import { networkPlugin } from '@tortoise/network/plugin';
import { deploymentPlugin } from '@tortoise/deployment/plugin';
import { createTelemetryPlugin } from '@tortoise/telemetry/plugin';
import type { TestRequestsRoot } from '@tortoise/pattern-base/application';
import {
  createTestRequestsHandlers,
  createTestRequestsState,
  testRequestsModule,
  testRequestsPolicy,
  type TestRequestsServices,
  type Role,
} from '@tortoise/pattern-base/server';
import manifest from './manifest';
import { testRequestsMigrations } from './migrations';

export interface TestRequestsOperationsOptions {
  members?: Record<string, Role>;
  services?: TestRequestsServices;
  /** Between telemetry exports; one minute when omitted. */
  telemetryIntervalMs?: number;
}

/**
 * The test requests module unchanged, at state version 2, with the plugins that run it on a plant machine:
 * the deployment policy (deployment), the network guard (network), the audit log and the OpenTelemetry
 * exporter. The plugins add no capabilities the screens need.
 */
export function createTestRequestsOperationsApplication(
  options: TestRequestsOperationsOptions = {},
) {
  return defineApplication<TestRequestsRoot, TestRequestsServices>({
    manifest,
    createState: (localUserId) => ({
      testRequests: createTestRequestsState(localUserId, options.members),
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
      deploymentPlugin,
      networkPlugin,
      auditPlugin,
      createTelemetryPlugin(
        options.telemetryIntervalMs ? { intervalMs: options.telemetryIntervalMs } : {},
      ),
    ],
  });
}

export default createTestRequestsOperationsApplication();

import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { connectTarget, type SystemOfRecordPort } from '@agent-native/integration';
import { defineApplication } from '@agent-native/host/application';
import { auditPlugin } from '@agent-native/audit/plugin';
import { compliancePlugin } from '@agent-native/compliance/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import manifest from './manifest';
import { operations, qualityTarget } from './contracts';
import type { QualityState } from './domain';
import {
  createQualityHandlers,
  createQualityState,
  qualityInspectionModule,
  qualityPolicy,
  type QualityServices,
} from './server';
import { FakeQualitySystem, toSyncInput, type QualityItem } from './fake-sor';

export interface QualityInspectionState {
  quality: QualityState;
}

/** The quality system integration's principal; distinct from every person and station. */
export const INTEGRATION_PRINCIPAL = 'integration';

/**
 * Demo only: the deterministic in-memory quality system, so the reference needs no enterprise
 * credentials. `DEMO_QUALITY_LOCKED_LOTS` (comma-separated lot numbers) simulates another SoR
 * user holding a lock, so forwarded records for those lots are rejected.
 * `DEMO_QUALITY_UNAVAILABLE=1` makes every delivery fail transiently. A deploying application
 * passes its real adapter instead; the framework never reads these variables.
 */
export function demoSystemOfRecord(env: Record<string, string | undefined> = process.env) {
  const systemOfRecord = new FakeQualitySystem();
  for (const lot of (env.DEMO_QUALITY_LOCKED_LOTS ?? '').split(',').filter(Boolean))
    systemOfRecord.lock(lot.trim());
  if (env.DEMO_QUALITY_UNAVAILABLE === '1') systemOfRecord.faults = { unavailable: true };
  return systemOfRecord;
}

/**
 * The quality-inspection application. `systemOfRecord` is the quality system port; without one,
 * every authority gets its own demo fake configured from the environment.
 */
export function createQualityInspectionApplication(
  options: { systemOfRecord?: SystemOfRecordPort<QualityItem>; services?: QualityServices } = {},
) {
  return defineApplication<QualityInspectionState, QualityServices>({
    manifest,
    createState: (ownerId) => ({
      quality: createQualityState({
        supervisorId: ownerId,
        integrationPrincipalId: INTEGRATION_PRINCIPAL,
      }),
    }),
    upgradeState: (state, ownerId) => {
      const value = (state ?? {}) as Partial<QualityInspectionState>;
      return {
        quality:
          value.quality ??
          createQualityState({
            supervisorId: ownerId,
            integrationPrincipalId: INTEGRATION_PRINCIPAL,
          }),
      };
    },
    handlers: sliceHandlers<QualityInspectionState, 'quality', QualityServices>(
      'quality',
      createQualityHandlers(),
    ),
    authorization: composeAuthorization<QualityInspectionState>([
      authorizationRoute(
        'quality',
        qualityInspectionModule,
        ['lot', 'result', 'defect', 'plant', 'sync'],
        qualityPolicy,
      ),
    ]),
    // The workspace owner (the supervisor) is the compliance plugin's first auditor.
    plugins: [sitePlugin, networkPlugin, auditPlugin, compliancePlugin],
    ...(options.services ? { services: options.services } : {}),
    selectableResources: { lot: operations.lotGet.id },
    connect: ({ application, workspaceId }) => ({
      integrations: [
        connectTarget<QualityItem>({
          target: qualityTarget,
          application,
          port: options.systemOfRecord ?? demoSystemOfRecord(),
          workspaceId,
          principalId: INTEGRATION_PRINCIPAL,
          toInput: toSyncInput,
        }),
      ],
    }),
  });
}

export default createQualityInspectionApplication();

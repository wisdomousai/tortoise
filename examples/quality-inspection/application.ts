import type { ExecutionContext } from '@agent-native/runtime';
import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { createTargetIntegration, type SystemOfRecordPort } from '@agent-native/integration';
import { defineApplication } from '@agent-native/host/application';
import {
  assuranceAuthorizationRoute,
  createAssuranceHandlers,
  createAssuranceState,
  type AssuranceServices,
  type AssuranceState,
} from '@agent-native/assurance/server';
import manifest from './manifest';
import { operations } from './contracts';
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
  /** Who may read the host's audit trail: the supervisor who owns the workspace. */
  assurance: AssuranceState;
}

/** The quality system integration's principal; distinct from every person and station. */
export const INTEGRATION_PRINCIPAL = 'integration';

/**
 * Trusted identity for the outbox dispatcher and inbound sync. Its grant names only the
 * operations those jobs need, so a misbehaving SoR adapter cannot drive business commands.
 */
export function integrationContext(workspaceId: string): ExecutionContext {
  return {
    workspaceId,
    principalId: INTEGRATION_PRINCIPAL,
    channel: 'integration',
    grant: {
      operations: [operations.lotSync.id, operations.effectSettle.id, operations.syncStatus.id],
      principalId: INTEGRATION_PRINCIPAL,
      workspaceId,
    },
  };
}

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
  return defineApplication<QualityInspectionState, QualityServices & AssuranceServices>({
    manifest,
    createState: (ownerId) => ({
      quality: createQualityState({
        supervisorId: ownerId,
        integrationPrincipalId: INTEGRATION_PRINCIPAL,
      }),
      assurance: createAssuranceState([ownerId]),
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
        assurance: value.assurance ?? createAssuranceState([ownerId]),
      };
    },
    handlers: [
      ...sliceHandlers<QualityInspectionState, 'quality', QualityServices & AssuranceServices>(
        'quality',
        createQualityHandlers(),
      ),
      ...sliceHandlers<QualityInspectionState, 'assurance', QualityServices & AssuranceServices>(
        'assurance',
        createAssuranceHandlers(),
      ),
    ],
    authorization: composeAuthorization<QualityInspectionState>([
      authorizationRoute(
        'quality',
        qualityInspectionModule,
        ['lot', 'result', 'defect', 'plant', 'sync'],
        qualityPolicy,
      ),
      assuranceAuthorizationRoute<QualityInspectionState>((state) => state.assurance),
    ]),
    ...(options.services ? { services: options.services } : {}),
    selectableResources: { lot: operations.lotGet.id },
    connect: ({ application, workspaceId }) => ({
      integrations: [
        createTargetIntegration<QualityItem>({
          application,
          port: options.systemOfRecord ?? demoSystemOfRecord(),
          context: integrationContext(workspaceId),
          settleOperation: operations.effectSettle.id,
          syncOperation: operations.lotSync.id,
          statusOperation: operations.syncStatus.id,
          toInput: toSyncInput,
        }),
      ],
    }),
  });
}

export default createQualityInspectionApplication();

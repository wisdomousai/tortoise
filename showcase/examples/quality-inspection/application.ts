import { authorizationRoute, composeAuthorization, sliceHandlers } from '@tortoise/runtime';
import { connectTarget, type SystemOfRecordPort } from '@tortoise/integration';
import { defineApplication } from '@tortoise/host/application';
import { auditPlugin } from '@tortoise/audit/plugin';
import { compliancePlugin } from '@tortoise/compliance/plugin';
import { networkPlugin } from '@tortoise/network/plugin';
import { processPlugin } from '@tortoise/process/plugin';
import { deploymentPlugin } from '@tortoise/deployment/plugin';
import { createDriverPlugin } from '@tortoise/connector-driver/plugin';
import {
  createDriverEventIngest,
  type DriverEventIngestOptions,
} from '@tortoise/connector-driver/connect';
import { driverServiceOf } from '@tortoise/connector-driver/open';
import { createPeerLinkPlugin } from '@tortoise/peer-link/plugin';
import manifest from './manifest';
import { operations, qualityTarget } from './contracts';
import { instrumentContract } from './contracts/instrument';
import { qualityPeerApi } from './contracts/peer';
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
/** The instrument driver's principal; it may only report readings. */
export const INSTRUMENT_PRINCIPAL = 'instrument';

/** The capture station's instrument driver, started through the process plugin when bound. */
export const instrumentDriverPlugin = createDriverPlugin({ contracts: [instrumentContract] });

/**
 * The peer link serving `qualityPeerApi`: receiving applications request inspections and
 * search lots for their people. No subject is ever mapped to the integration or instrument
 * principal.
 */
export const qualityPeerLinkPlugin = createPeerLinkPlugin({
  api: qualityPeerApi,
  reserved: [INTEGRATION_PRINCIPAL, INSTRUMENT_PRINCIPAL],
});

const qualityState = (ownerId: string) =>
  createQualityState({
    supervisorId: ownerId,
    integrationPrincipalId: INTEGRATION_PRINCIPAL,
    instrumentPrincipalId: INSTRUMENT_PRINCIPAL,
  });

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
 * Instrument readings into the application: each `measurement.taken` event from the instrument
 * driver runs the ingest command as the instrument principal, whose grant names nothing else.
 */
export function createInstrumentIngest(options: {
  application: DriverEventIngestOptions['application'];
  workspaceId: string;
  service: DriverEventIngestOptions['service'];
  now?: () => number;
}) {
  return createDriverEventIngest({
    contract: instrumentContract,
    service: options.service,
    application: options.application,
    context: {
      workspaceId: options.workspaceId,
      principalId: INSTRUMENT_PRINCIPAL,
      grant: { operations: [operations.instrumentIngest.id] },
    },
    ingestOperation: operations.instrumentIngest.id,
    events: ['measurement.taken'],
    // The payload goes first, so it cannot replace the provenance fields.
    toInput: ({ session, seq, payload, observedAt, device }) => ({
      ...(payload as object),
      session,
      seq,
      observedAt,
      device,
    }),
    ...(options.now ? { now: options.now } : {}),
  });
}

/**
 * The quality-inspection application. `systemOfRecord` is the quality system port; without one,
 * every instance gets its own demo fake configured from the environment.
 */
export function createQualityInspectionApplication(
  options: { systemOfRecord?: SystemOfRecordPort<QualityItem>; services?: QualityServices } = {},
) {
  return defineApplication<QualityInspectionState, QualityServices>({
    manifest,
    createState: (ownerId) => ({ quality: qualityState(ownerId) }),
    upgradeState: (state, ownerId) => {
      const value = (state ?? {}) as Partial<QualityInspectionState>;
      // State saved before instrument readings or inspection requests existed gains the empty sets and
      // the instrument principal.
      return {
        quality: value.quality
          ? {
              ...value.quality,
              instrumentPrincipalId: value.quality.instrumentPrincipalId ?? INSTRUMENT_PRINCIPAL,
              instrumentReadings: value.quality.instrumentReadings ?? {},
              inspectionRequests: value.quality.inspectionRequests ?? {},
              requestSequence: value.quality.requestSequence ?? 0,
            }
          : qualityState(ownerId),
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
        ['lot', 'result', 'defect', 'plant', 'sync', 'instrument', 'inspection-request'],
        qualityPolicy,
      ),
    ]),
    // The workspace owner (the supervisor) is the compliance plugin's first auditor.
    plugins: [
      deploymentPlugin,
      networkPlugin,
      auditPlugin,
      compliancePlugin,
      processPlugin,
      instrumentDriverPlugin,
      qualityPeerLinkPlugin,
    ],
    ...(options.services ? { services: options.services } : {}),
    selectableResources: { lot: operations.lotGet.id },
    connect: ({ application, workspaceId, processes, services }) => ({
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
      observe: async (onError) => {
        // Optional hardware: without a policy binding for the driver there is nothing to watch.
        if (!processes.availability(instrumentContract.process.id).available) return [];
        const ingest = createInstrumentIngest({
          application,
          workspaceId,
          service: driverServiceOf(services),
        });
        ingest.start((error) => onError('instrument', error));
        return [ingest];
      },
    }),
  });
}

export default createQualityInspectionApplication();

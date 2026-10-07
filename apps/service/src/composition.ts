import type { EventLogPort } from '@agent-native/contracts';
import {
  authorizationRoute,
  composeAuthorization,
  createApplication,
  sliceHandlers,
  type ExecutionContext,
  type Storage,
} from '@agent-native/runtime';
import {
  createEffectDispatcher,
  createInboundSync,
  type SystemOfRecordPort,
} from '@agent-native/integration';
import {
  createProjectTaskHandlers,
  createProjectTaskState,
  projectTaskPolicy,
  projectTasksModule,
  type ProjectTaskServices,
} from '../../../examples/project-tasks/server';
import type { ProjectTaskState } from '../../../examples/project-tasks/domain';
import {
  createQualityHandlers,
  createQualityState,
  qualityInspectionModule,
  qualityPolicy,
  type QualityServices,
} from '../../../examples/quality-inspection/server';
import { operations as quality } from '../../../examples/quality-inspection/contracts';
import type { QualityState } from '../../../examples/quality-inspection/domain';
import { toSyncInput, type QualityItem } from '../../../examples/quality-inspection/fake-sor';
import {
  createLineHandlers,
  createLineState,
  lineStationModule,
  linePolicy,
  type LineServices,
} from '../../../examples/line-station/server';
import { operations as line } from '../../../examples/line-station/contracts';
import { stationRole, type LineState } from '../../../examples/line-station/domain';
import {
  toSyncInput as toMesSyncInput,
  type MesItem,
} from '../../../examples/line-station/fake-mes';
import {
  createDeviceHandlers,
  createDeviceState,
  deviceAuthorizationRoute,
  type DeviceState,
} from '@agent-native/devices/server';
import { applicationModules } from './modules';
import { hostComponents } from './components';

/** Composed feature state. Each module's handlers and policy see only their own slice. */
export interface ApplicationState {
  projectTasks: ProjectTaskState;
  quality: QualityState;
  lineStation: LineState;
  devices: DeviceState;
}
export type ApplicationServices = ProjectTaskServices & QualityServices & LineServices;

export const INTEGRATION_PRINCIPAL = 'integration';
/** The homebrew MES integration; separate from the quality integration and every station bridge. */
export const MES_PRINCIPAL = 'mes-integration';

export function createApplicationState(ownerId = 'owner'): ApplicationState {
  return {
    projectTasks: createProjectTaskState(ownerId),
    quality: createQualityState({
      supervisorId: ownerId,
      integrationPrincipalId: INTEGRATION_PRINCIPAL,
    }),
    lineStation: createLineState({
      mesPrincipalId: MES_PRINCIPAL,
      stations: [
        { id: 'line-1', name: 'Filler 1', line: 'Line 1', members: { [ownerId]: 'supervisor' } },
      ],
    }),
    devices: createDeviceState(),
  };
}

/**
 * Upgrade persisted state from earlier versions. Workspaces created before modules were composed
 * hold the project/task state at the root; it moves under `projectTasks` unchanged.
 */
export function upgradeApplicationState(state: unknown, ownerId = 'owner'): ApplicationState {
  const value = (state ?? {}) as Record<string, unknown>;
  const fresh = createApplicationState(ownerId);
  return {
    projectTasks:
      'projects' in value
        ? (value as unknown as ProjectTaskState)
        : ((value.projectTasks as ProjectTaskState | undefined) ?? fresh.projectTasks),
    quality: (value.quality as QualityState | undefined) ?? fresh.quality,
    lineStation: (value.lineStation as LineState | undefined) ?? fresh.lineStation,
    devices: (value.devices as DeviceState | undefined) ?? fresh.devices,
  };
}

/** UI selections the host validates before capturing them for an agent run. */
export const selectableResources: Readonly<Record<string, string>> = {
  project: 'project.get',
  task: 'task.get',
  lot: quality.lotGet.id,
};

export const applicationAuthorization = composeAuthorization<ApplicationState>([
  authorizationRoute('projectTasks', projectTasksModule, ['project', 'task'], projectTaskPolicy),
  authorizationRoute(
    'quality',
    qualityInspectionModule,
    ['lot', 'result', 'defect', 'plant', 'sync'],
    qualityPolicy,
  ),
  authorizationRoute(
    'lineStation',
    lineStationModule,
    ['station', 'stop', 'count', 'attention', 'order', 'counters', 'mes'],
    linePolicy,
  ),
  // Device configuration follows station roles: supervisors administer, everyone else reads.
  deviceAuthorizationRoute<ApplicationState>((state) => ({
    config: state.devices,
    access(principalId, station) {
      const role = stationRole(state.lineStation, principalId, station);
      return role === 'supervisor' ? 'administer' : role ? 'read' : undefined;
    },
  })),
]);

/** Compose the application once; HTTP, embedded MCP and tests all use this definition. */
export function createApplicationRuntime(options: {
  storage: Storage<ApplicationState>;
  services?: ApplicationServices;
  now?: () => number;
  newEffectId?: () => string;
  /** Audit sink; the host passes the deployment's event log (see `openSecurity`). */
  eventLog?: EventLogPort;
}) {
  return createApplication({
    modules: applicationModules,
    components: hostComponents,
    handlers: [
      ...sliceHandlers<ApplicationState, 'projectTasks', ApplicationServices>(
        'projectTasks',
        createProjectTaskHandlers(),
      ),
      ...sliceHandlers<ApplicationState, 'quality', ApplicationServices>(
        'quality',
        createQualityHandlers(),
      ),
      ...sliceHandlers<ApplicationState, 'lineStation', ApplicationServices>(
        'lineStation',
        createLineHandlers(),
      ),
      ...sliceHandlers<ApplicationState, 'devices', ApplicationServices>(
        'devices',
        createDeviceHandlers(),
      ),
    ],
    storage: options.storage,
    authorization: applicationAuthorization,
    services: options.services ?? {},
    ...(options.now ? { now: options.now } : {}),
    ...(options.newEffectId ? { newEffectId: options.newEffectId } : {}),
    ...(options.eventLog ? { eventLog: options.eventLog } : {}),
  });
}
export type ApplicationRuntime = ReturnType<typeof createApplicationRuntime>;

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
      operations: [quality.lotSync.id, quality.effectSettle.id, quality.syncStatus.id],
      principalId: INTEGRATION_PRINCIPAL,
      workspaceId,
    },
  };
}

/** Wire the quality system port to the outbox dispatcher and inbound master-data sync. */
export function createQualityIntegration(options: {
  application: ApplicationRuntime;
  port: SystemOfRecordPort<QualityItem>;
  workspaceId: string;
}) {
  const context = integrationContext(options.workspaceId);
  const dispatcher = createEffectDispatcher({
    application: options.application,
    port: options.port,
    context,
    settleOperation: quality.effectSettle.id,
  });
  const inbound = createInboundSync<QualityItem>({
    application: options.application,
    port: options.port,
    context,
    syncOperation: quality.lotSync.id,
    readCursor: async () =>
      (await options.application.query({ operation: 'inspection.sync.status', input: {} }, context))
        .data.watermark,
    toInput: toSyncInput,
  });
  return {
    dispatcher,
    inbound,
    start(intervals: { deliverMs?: number; syncMs?: number } = {}) {
      inbound.start(intervals.syncMs ?? 5_000);
      dispatcher.start(intervals.deliverMs ?? 1_000);
    },
    async stop() {
      await Promise.all([inbound.stop(), dispatcher.stop()]);
    },
  };
}

/**
 * Wire the homebrew MES to its outbox dispatcher and inbound order/reason sync, under the MES
 * principal. Its grant cannot reach station screens, observations or any people's command.
 */
export function createLineIntegration(options: {
  application: ApplicationRuntime;
  port: SystemOfRecordPort<MesItem>;
  workspaceId: string;
}) {
  const context: ExecutionContext = {
    workspaceId: options.workspaceId,
    principalId: MES_PRINCIPAL,
    channel: 'integration',
    grant: {
      operations: [line.mesSync.id, line.effectSettle.id, line.syncStatus.id],
      principalId: MES_PRINCIPAL,
      workspaceId: options.workspaceId,
    },
  };
  const dispatcher = createEffectDispatcher({
    application: options.application,
    port: options.port,
    context,
    settleOperation: line.effectSettle.id,
  });
  const inbound = createInboundSync<MesItem>({
    application: options.application,
    port: options.port,
    context,
    syncOperation: line.mesSync.id,
    readCursor: async () =>
      (await options.application.query({ operation: 'line.sync.status', input: {} }, context)).data
        .watermark,
    toInput: toMesSyncInput,
  });
  return {
    dispatcher,
    inbound,
    start(intervals: { deliverMs?: number; syncMs?: number } = {}) {
      inbound.start(intervals.syncMs ?? 5_000);
      dispatcher.start(intervals.deliverMs ?? 1_000);
    },
    async stop() {
      await Promise.all([inbound.stop(), dispatcher.stop()]);
    },
  };
}

import {
  approvalFeature,
  authorizationRoute,
  composeAuthorization,
  sliceHandlers,
  type ApprovalAccess,
  type ApprovalHooks,
} from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { mountFeature } from '@agent-native/host/feature';
import { auditPlugin } from '@agent-native/audit/plugin';
import { compliancePlugin } from '@agent-native/compliance/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { notificationsPlugin } from '@agent-native/notifications/plugin';
import { osPlugin } from '@agent-native/os/plugin';
import { osShortcutsPlugin } from '@agent-native/os-shortcuts/plugin';
import { shareTargetPlugin } from '@agent-native/share-target/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import { webhookPlugin } from '@agent-native/webhook/plugin';
import manifest from './manifest';
import { operations } from './contracts';
import { migrations, storedSlice, type ServiceState } from './domain';
import {
  approvalAccess,
  createServiceHandlers,
  createServiceState,
  servicePolicy,
  fieldServiceModule,
  type WorkOrderServices,
} from './server';

/**
 * Workspace state: one slice, so the module composes unchanged next to others. Feature and plugin
 * slices (approval requests, the compliance auditors) are added by `defineApplication` under
 * their ids.
 */
export interface FieldServiceState {
  fieldService: ServiceState;
}

/**
 * The field-service application the starter hosts. Workspaces written before modules were
 * composed hold work order/task state at the root; upgrade moves it under `fieldService` unchanged.
 * A workspace composed with other modules keeps only this slice.
 */
export function createFieldServiceApplication(options: { services?: WorkOrderServices } = {}) {
  return defineApplication<FieldServiceState, WorkOrderServices>({
    manifest,
    createState: (ownerId) => ({ fieldService: createServiceState(ownerId) }),
    migrations,
    upgradeState(state, ownerId) {
      const slice = (storedSlice(state) ?? createServiceState(ownerId)) as ServiceState;
      // Workspaces from before reminders get an empty map for them.
      return { fieldService: { ...slice, reminderEffects: slice.reminderEffects ?? {} } };
    },
    handlers: sliceHandlers<FieldServiceState, 'fieldService', WorkOrderServices>(
      'fieldService',
      createServiceHandlers(),
    ),
    authorization: composeAuthorization<FieldServiceState>([
      authorizationRoute('fieldService', fieldServiceModule, ['work-order', 'task'], servicePolicy),
    ]),
    features: [
      mountFeature<FieldServiceState, ApprovalAccess, ApprovalHooks, WorkOrderServices>(
        approvalFeature(),
        {
          access: (state) => approvalAccess(state.fieldService),
          hooks: {
            newId: (ctx) => (ctx.services.newId ?? (() => crypto.randomUUID()))(),
            now: (ctx) => (ctx.services.now ?? Date.now)(),
          },
          // Version 1 kept approval requests in the task slice, or at the root before modules
          // were composed.
          adopt: {
            before: 2,
            from: (stored) => ({ requests: storedSlice(stored)?.approvals ?? {} }),
          },
        },
      ),
    ],
    ...(options.services ? { services: options.services } : {}),
    selectableResources: { 'work-order': operations.workOrderGet.id, task: operations.taskGet.id },
    plugins: [
      sitePlugin,
      networkPlugin,
      auditPlugin,
      compliancePlugin,
      osPlugin,
      shareTargetPlugin,
      notificationsPlugin,
      osShortcutsPlugin,
      webhookPlugin,
    ],
  });
}

export default createFieldServiceApplication();

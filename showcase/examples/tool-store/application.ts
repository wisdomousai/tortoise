import { defineApplication } from '@tortoise/host/application';
import { auditPlugin } from '@tortoise/audit/plugin';
import { compliancePlugin } from '@tortoise/compliance/plugin';
import { networkPlugin } from '@tortoise/network/plugin';
import { sitePlugin } from '@tortoise/site/plugin';
import { createStationSignInPlugin } from '@tortoise/workstation-sign-in/plugin';
import manifest from './manifest';
import { createState, upgradeState, type AppState, type Role } from './domain';
import { appPolicy, createHandlers, type Services } from './server';
import { mountFeature } from '@tortoise/host/feature';
import { newId, now } from './handlers/context';
import {
  approvalAccess,
  assignmentAccess,
  deviceAccess,
  eamPrincipal,
  handoverAccess,
  reconciliationAccess,
} from './policy';
import {
  handoverFeature,
  type HandoverAccess,
  type HandoverHooks,
} from './features/handover/feature';
import { deviceFeature, type DeviceAccess } from '@tortoise/devices/server';
import { connectTarget, type SystemOfRecordPort } from '@tortoise/integration';
import {
  approvalFeature,
  reconciliationFeature,
  type ApprovalAccess,
  type ApprovalHooks,
  type ReconciliationAccess,
  type ReconciliationHooks,
} from '@tortoise/runtime';
import { eamTarget, type EamTool } from './contracts/eam-target';
import { FakeEam, tagList } from './eam-port';
import { recordReconciled } from './handlers/eam-target';
import { checkRetireRequest } from './handlers/tool-retire';
import { toolRetire } from './contracts/tool-retire';
import {
  assignmentFeature,
  type AssignmentAccess,
  type AssignmentHooks,
} from '@tortoise/assignments/server';
import { assignments } from './contracts/assignments';
import { assignmentHooks } from './handlers/assignments';
// scaffold:imports

export interface ToolStoreOptions {
  services?: Services;
  /** People who work in a new workspace besides its owner, who is always an attendant. */
  members?: Record<string, Role>;
  /** The connector to the plant EAM; an in-memory fake EAM that knows every asset tag when omitted. */
  eam?: SystemOfRecordPort<EamTool>;
  // scaffold:options
}

/**
 * The people who sign in at the counter terminal in a new workspace. An operator acts with their
 * own role, so each badge the owner enrolls must name one of these principals. A workspace keeps
 * the members it was created with.
 */
// #region members
export const counterMembers: Record<string, Role> = {
  'mia@plant': 'attendant',
  'jonas@plant': 'attendant',
  'sam@plant': 'viewer',
};
// #endregion members

/**
 * The Tool Store application with the site, network, audit, compliance and station sign-in
 * plugins. The sign-in plugin uses the instance clock from `services.now`, so a test can expire an
 * operator session.
 */
export function createToolStoreApplication(options: ToolStoreOptions = {}) {
  const state = (ownerId: string) => createState(ownerId, options.members);
  const clock = options.services?.now;
  return defineApplication<AppState, Services>({
    manifest,
    createState: state,
    upgradeState: (stored, ownerId) => upgradeState(stored, state(ownerId)),
    features: [
      mountFeature<AppState, HandoverAccess, HandoverHooks, Services>(handoverFeature(), {
        access: handoverAccess,
        hooks: { newId: (ctx) => newId(ctx), now: (ctx) => now(ctx) },
      }),
      // The counter's scanner profile and scan routes, in the feature's own `device` slice.
      mountFeature<AppState, DeviceAccess, unknown, Services>(deviceFeature(), {
        access: deviceAccess,
      }),
      // A person's decision on a held repair order commits with its outcome on the loan.
      mountFeature<AppState, ReconciliationAccess, ReconciliationHooks, Services>(
        reconciliationFeature(),
        {
          access: reconciliationAccess,
          hooks: {
            onResolved: (effect, _decision, outcome, ctx) => recordReconciled(effect, outcome, ctx),
          },
        },
      ),
      // Requests to retire a tool, the only command an approval may name, which an attendant decides.
      mountFeature<AppState, ApprovalAccess, ApprovalHooks, Services>(
        approvalFeature({ commands: [toolRetire] }),
        {
          access: approvalAccess,
          hooks: {
            newId: (ctx) => newId(ctx),
            now: (ctx) => now(ctx),
            request: (operation, input, ctx) => checkRetireRequest(operation, input, ctx),
          },
        },
      ),
      // Cycle counts of one bin: accepting a report sets tools missing or available again.
      mountFeature<AppState, AssignmentAccess, AssignmentHooks, Services>(
        assignmentFeature(assignments),
        { access: assignmentAccess, hooks: assignmentHooks },
      ),
      // scaffold:features
    ],
    handlers: createHandlers(),
    authorization: appPolicy,
    // #region selectable
    // The counter at the terminal shares the open tool with agent runs as tool:<id>. A UI session
    // may also name a cycle count or one of its reports, as assignment:<id> or
    // assignment-report:<id>, which the caller must be able to read.
    selectableResources: {
      tool: 'tool.get',
      assignment: assignments.operations.get.id,
      'assignment-report': assignments.operations.reportGet.id,
    },
    // #endregion selectable
    // #region plugins
    plugins: [
      sitePlugin,
      networkPlugin,
      auditPlugin,
      compliancePlugin,
      createStationSignInPlugin(clock ? { now: clock } : {}),
    ],
    // #endregion plugins
    ...(options.services ? { services: options.services } : {}),
    connect: ({ application, workspaceId }) => ({
      integrations: [
        connectTarget<EamTool>({
          target: eamTarget,
          application,
          port: options.eam ?? new FakeEam(),
          workspaceId,
          principalId: eamPrincipal,
        }),
        // scaffold:integrations
      ],
    }),
  });
}

/** The demo's fake EAM refuses the asset tags DEMO_EAM_UNKNOWN_TAGS lists, comma-separated. */
export default createToolStoreApplication({
  members: counterMembers,
  eam: new FakeEam({ unknownTags: tagList(process.env.DEMO_EAM_UNKNOWN_TAGS) }),
});

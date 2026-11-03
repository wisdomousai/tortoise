import { defineApplication } from '@agent-native/host/application';
import { auditPlugin } from '@agent-native/audit/plugin';
import { compliancePlugin } from '@agent-native/compliance/plugin';
import { createModelServer } from '@agent-native/model-server/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { processPlugin } from '@agent-native/process/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import manifest from './manifest';
import { ASSISTANT_MODEL_PROCESS } from './contracts/assistant-agent';
import { assistantModelFrom, type AssistantModel } from './model';
import { createState, upgradeState, type AppState, type Role } from './domain';
import { appPolicy, createHandlers, type Services } from './server';
import { operations } from './contracts';
import { approvalFeature, type ApprovalAccess, type ApprovalHooks } from '@agent-native/runtime';
import { mountFeature } from '@agent-native/host/feature';
import { newId, now } from './handlers/context';
import { approvalAccess } from './policy';
// scaffold:imports

export interface PartsDeskOptions {
  services?: Services;
  /** People who work in a new workspace besides its owner, who is always a desk member. */
  members?: Record<string, Role>;
  /** The assistant's model entry, files and activation; `assistantModelFrom()` when omitted. */
  model?: AssistantModel;
  /** How often the model server polls the model list while it starts. */
  pollMs?: number;
  // scaffold:options
}

/**
 * The Parts Desk application with the site, network, process, audit, compliance and model server
 * plugins, and the model server's handle. The model server measures the assistant's weights
 * against the `parts-desk-assistant` entry and starts llama-server through the process port.
 * It offers its harness to the host's run route, so a run of the assistant started without a
 * harness runs on it and records the measured digests.
 */
export function composePartsDesk(options: PartsDeskOptions = {}) {
  const model = options.model ?? assistantModelFrom();
  const models = createModelServer({
    process: ASSISTANT_MODEL_PROCESS,
    runtime: 'llama-server',
    entry: model.entry,
    files: model.files,
    ...(model.activation ? { activation: model.activation } : {}),
    ...(options.pollMs ? { pollMs: options.pollMs } : {}),
  });
  const state = (ownerId: string) => createState(ownerId, options.members);
  const application = defineApplication<AppState, Services>({
    manifest,
    createState: state,
    upgradeState: (stored, ownerId) => upgradeState(stored, state(ownerId)),
    features: [
      mountFeature<AppState, ApprovalAccess, ApprovalHooks, Services>(approvalFeature(), {
        access: approvalAccess,
        hooks: { newId: (ctx) => newId(ctx), now: (ctx) => now(ctx) },
      }),
      // scaffold:features
    ],
    handlers: createHandlers(),
    authorization: appPolicy,
    // The records the screens hand to the assistant panel, whose UI session selects them. The
    // host reads each one through its get query as the person before a run captures it.
    selectableResources: {
      inquiry: operations.inquiryGet.id,
      transformer: operations.transformerGet.id,
      part: operations.partGet.id,
      quote: operations.quoteGet.id,
    },
    plugins: [
      sitePlugin,
      networkPlugin,
      processPlugin,
      auditPlugin,
      compliancePlugin,
      models.plugin,
    ],
    ...(options.services ? { services: options.services } : {}),
    connect: ({ application, workspaceId }) => ({
      integrations: [
        // scaffold:integrations
      ],
    }),
  });
  return { application, models };
}

/** The Parts Desk application; see `composePartsDesk`. */
export function createPartsDeskApplication(options: PartsDeskOptions = {}) {
  return composePartsDesk(options).application;
}

export default createPartsDeskApplication();

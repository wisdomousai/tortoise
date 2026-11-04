import { defineApplication } from '@tortoise/host/application';
import { auditPlugin } from '@tortoise/audit/plugin';
import { compliancePlugin } from '@tortoise/compliance/plugin';
import { networkPlugin } from '@tortoise/network/plugin';
import { deploymentPlugin } from '@tortoise/deployment/plugin';
import manifest from './manifest';
import { createState, upgradeState, type AppState, type Role } from './domain';
import { appPolicy, createHandlers, type Services } from './server';
// scaffold:imports

export interface {{app.pascal}}Options {
  services?: Services;
  /** People who work in a new workspace besides its owner, who is always an editor. */
  members?: Record<string, Role>;
  // scaffold:options
}

/** The {{displayName}} application with the deployment, network, audit and compliance plugins. */
export function create{{app.pascal}}Application(options: {{app.pascal}}Options = {}) {
  const state = (ownerId: string) => createState(ownerId, options.members);
  return defineApplication<AppState, Services>({
    manifest,
    createState: state,
    upgradeState: (stored, ownerId) => upgradeState(stored, state(ownerId)),
    features: [
      // scaffold:features
    ],
    handlers: createHandlers(),
    authorization: appPolicy,
    plugins: [deploymentPlugin, networkPlugin, auditPlugin, compliancePlugin],
    ...(options.services ? { services: options.services } : {}),
    connect: ({ application, workspaceId }) => ({
      integrations: [
        // scaffold:integrations
      ],
    }),
  });
}

export default create{{app.pascal}}Application();

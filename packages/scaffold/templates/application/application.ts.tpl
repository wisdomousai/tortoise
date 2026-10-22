import { defineApplication } from '@agent-native/host/application';
import { auditPlugin } from '@agent-native/audit/plugin';
import { compliancePlugin } from '@agent-native/compliance/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
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

/** The {{displayName}} application with the site, network, audit and compliance plugins. */
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
    plugins: [sitePlugin, networkPlugin, auditPlugin, compliancePlugin],
    ...(options.services ? { services: options.services } : {}),
    connect: ({ application, workspaceId }) => ({
      integrations: [
        // scaffold:integrations
      ],
    }),
  });
}

export default create{{app.pascal}}Application();

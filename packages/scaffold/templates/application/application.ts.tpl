import { defineApplication } from '@tortoise/host/application';
import { auditPlugin } from '@tortoise/audit/plugin';
import { compliancePlugin } from '@tortoise/compliance/plugin';
import { networkPlugin } from '@tortoise/network/plugin';
import { sitePlugin } from '@tortoise/site/plugin';
import manifest from './manifest';
import { createState, upgradeState, type AppState, type Role } from './domain';
import { appPolicy, createHandlers, type Services } from './server';
// scaffold:imports

export interface {{app.pascal}}Options {
  services?: Services;
  /** People who work in a new workspace besides the local user, who is always an editor. */
  members?: Record<string, Role>;
  // scaffold:options
}

/** The {{displayName}} application with the site, network, audit and compliance plugins. */
export function create{{app.pascal}}Application(options: {{app.pascal}}Options = {}) {
  const state = (localUserId: string) => createState(localUserId, options.members);
  return defineApplication<AppState, Services>({
    manifest,
    createState: state,
    upgradeState: (stored, localUserId) => upgradeState(stored, state(localUserId)),
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

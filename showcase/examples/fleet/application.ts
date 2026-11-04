import { defineApplication } from '@tortoise/host/application';
import { auditPlugin } from '@tortoise/audit/plugin';
import { createDeviceLinkPlugin } from '@tortoise/device-link/plugin';
import { fleetSiteOperationIds } from '@tortoise/fleet-agent/contracts';
import { networkPlugin } from '@tortoise/network/plugin';
import { sitePlugin } from '@tortoise/site/plugin';
import manifest from './manifest';
import { createState, type AppState, type Role } from './domain';
import { appPolicy, createHandlers, type Services } from './server';

export interface FleetOptions {
  services?: Services;
  /** People who work in a new workspace besides the local user, who is always an operator. */
  members?: Record<string, Role>;
}

/**
 * The Fleet application: sites enroll through the device-link plugin as `field-sync` devices and
 * call the fleet protocol as their own principal. It has no outbox target and no site-pinned
 * requirement, so it runs on a site host or as a hosted instance alike.
 */
export function createFleetApplication(options: FleetOptions = {}) {
  return defineApplication<AppState, Services>({
    manifest,
    createState: (localUserId) => createState(localUserId, options.members),
    handlers: createHandlers(),
    authorization: appPolicy,
    plugins: [
      sitePlugin,
      networkPlugin,
      auditPlugin,
      createDeviceLinkPlugin({ syncOperations: fleetSiteOperationIds }),
    ],
    ...(options.services ? { services: options.services } : {}),
  });
}

export default createFleetApplication();

import type { z } from 'zod';
import {
  connectTarget,
  createPeerCall,
  createPeerDrift,
  createPeerPort,
} from '@agent-native/integration';
import { defineApplication } from '@agent-native/kernel/application';
import type { AnyHostPlugin } from '@agent-native/kernel/plugin';
import type { fieldAssignmentSchema } from '@agent-native/asset-survey/contracts/schemas';
import { createHubLinkPlugin } from '@agent-native/hub-link/plugin';
import { hubTarget } from './contracts';
import { createFieldState, type FieldState } from './domain';
import { createFieldHandlers, type FieldServices } from './handlers';
import { fieldManifest } from './manifest';
import { fieldPolicy } from './policy';

/** The principal that delivers to the hub and applies its feed. */
export const INTEGRATION_PRINCIPAL = 'integration';

/**
 * The field application. Hub-link comes first; `plugins` adds the native ones a device build
 * composes (managed configuration, the intent scanner), so the same domain runs under Bun in
 * tests without them. `fetch` replaces the hub-link plugin's, for tests that drop the network.
 */
export function createFieldApplication(
  options: {
    plugins?: readonly AnyHostPlugin[];
    fetch?: typeof fetch;
    services?: FieldServices;
  } = {},
) {
  const plugins = [
    createHubLinkPlugin(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.plugins ?? []),
  ];
  return defineApplication<FieldState, FieldServices>({
    manifest: fieldManifest(plugins.map((plugin) => plugin.manifest)),
    createState: (ownerId) => createFieldState(ownerId, INTEGRATION_PRINCIPAL),
    upgradeState: (stored, ownerId) =>
      (stored as FieldState | undefined) ?? createFieldState(ownerId, INTEGRATION_PRINCIPAL),
    handlers: createFieldHandlers(),
    authorization: fieldPolicy,
    ...(options.services ? { services: options.services } : {}),
    plugins,
    connect: ({ application, workspaceId, network }) => {
      const client = () => network.client(hubTarget.target);
      // The hub's contract as this device reads it; a hub release that changed one of the field
      // surface's operations keeps captures and returns pending instead of misreading them.
      const drift = createPeerDrift({
        surface: hubTarget.surface,
        contract: () => createPeerCall({ client }).contract(),
      });
      return {
        integrations: [
          connectTarget<z.output<typeof fieldAssignmentSchema>>({
            application,
            workspaceId,
            principalId: INTEGRATION_PRINCIPAL,
            target: hubTarget,
            // The hub's own API, as this device: the hub authorizes every record again.
            port: createPeerPort({
              target: hubTarget.target,
              client,
              readBlob: (effect, digest) =>
                application.readEffectBlob(workspaceId, effect.id, digest),
              feed: hubTarget.feedQuery,
              drift,
            }),
          }),
        ],
      };
    },
  });
}

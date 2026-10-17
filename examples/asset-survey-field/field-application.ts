import type { z } from 'zod';
import { connectTarget, createPeerPort } from '@agent-native/integration';
import { defineApplication } from '@agent-native/kernel/application';
import type { AnyHostPlugin } from '@agent-native/kernel/plugin';
import { operations as hubOperations } from '@agent-native/asset-survey/contracts';
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
    connect: ({ application, workspaceId, network }) => ({
      integrations: [
        connectTarget<z.output<typeof fieldAssignmentSchema>>({
          application,
          workspaceId,
          principalId: INTEGRATION_PRINCIPAL,
          target: hubTarget,
          // The hub's own API, as this device: the hub authorizes every record again.
          port: createPeerPort({
            target: hubTarget.target,
            client: () => network.client(hubTarget.target),
            readBlob: (effect, digest) =>
              application.readEffectBlob(workspaceId, effect.id, digest),
            feed: hubOperations.assignmentFeed.id,
          }),
        }),
      ],
    }),
  });
}

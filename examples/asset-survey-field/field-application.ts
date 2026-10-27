import { defineApplication } from '@agent-native/kernel/application';
import type { AnyHostPlugin } from '@agent-native/kernel/plugin';
import { connectWorklist, worklistHandlers } from '@agent-native/assignments/server';
import { createHubLinkPlugin } from '@agent-native/hub-link/plugin';
import { worklist } from './contracts';
import { createFieldState, migrations, type FieldServices, type FieldState } from './domain';
import { fieldManifest } from './manifest';
import { fieldPolicy } from './policy';

/** The principal that delivers to the hub and applies its feed. */
export const INTEGRATION_PRINCIPAL = 'integration';

/**
 * The field application: the worklist of the surveys the hub sends this device. Hub-link comes
 * first; `plugins` adds the native ones a device build composes (managed configuration, the
 * intent scanner), so the same domain runs under Bun in tests without them. `fetch` replaces the
 * hub-link plugin's, for tests that drop the network.
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
    migrations,
    handlers: worklistHandlers<FieldState, FieldServices, (typeof worklist.kinds)[number]>(
      worklist,
      {
        slice: (state) => state.worklist,
        newId: (ctx) => (ctx.services.newId ?? (() => crypto.randomUUID()))(),
        now: (ctx) => (ctx.services.now ?? Date.now)(),
      },
    ),
    authorization: fieldPolicy,
    ...(options.services ? { services: options.services } : {}),
    plugins,
    // Captures and done marks go to the hub's own API as this device, through hub-link's client;
    // the hub authorizes every one again. A hub release that changed one of the device lane's
    // operations keeps them waiting instead of misreading them.
    connect: ({ application, workspaceId, network }) => ({
      integrations: [
        connectWorklist(worklist, {
          application,
          workspaceId,
          principalId: INTEGRATION_PRINCIPAL,
          client: () => network.client(worklist.target.target),
        }),
      ],
    }),
  });
}

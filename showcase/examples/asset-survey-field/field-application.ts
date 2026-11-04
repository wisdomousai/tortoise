import { defineApplication } from '@tortoise/kernel/application';
import type { AnyHostPlugin } from '@tortoise/kernel/plugin';
import { connectWorklist, worklistHandlers } from '@tortoise/assignments/server';
import { androidIntentsPlugin } from '@tortoise/android-intents/plugin';
import { createHubLinkPlugin } from '@tortoise/hub-link/plugin';
import { notificationsPlugin } from '@tortoise/notifications/plugin';
import { createOsPlugin } from '@tortoise/os/plugin';
import { shareTargetPlugin } from '@tortoise/share-target/plugin';
import { fieldOperations, worklist } from './contracts';
import { createFieldState, migrations, type FieldServices, type FieldState } from './domain';
import { createFieldHandlers, notifyNewSurvey } from './handlers';
import { fieldManifest } from './manifest';
import { fieldPolicy } from './policy';

/** The principal that delivers to the hub and applies its feed. */
export const INTEGRATION_PRINCIPAL = 'integration';

/**
 * The field application: the worklist of the surveys the hub sends this device. Hub-link and the
 * OS plugins come first: the OS plugin, then the ones that serve its share, notify and intent
 * declarations. Android intents is composed on every platform because startup refuses declared
 * intents without it; on iOS an intent action is refused instead. `plugins` adds the native ones
 * a device build composes (managed configuration, the intent scanner), so the same domain runs
 * under Bun in tests without them. `fetch` replaces the hub-link plugin's, for tests that drop
 * the network.
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
    createOsPlugin(),
    shareTargetPlugin,
    notificationsPlugin,
    androidIntentsPlugin,
    ...(options.plugins ?? []),
  ];
  return defineApplication<FieldState, FieldServices>({
    manifest: fieldManifest(plugins.map((plugin) => plugin.manifest)),
    createState: (localUserId) => createFieldState(localUserId, INTEGRATION_PRINCIPAL),
    migrations,
    handlers: [
      ...worklistHandlers<FieldState, FieldServices, (typeof worklist.kinds)[number]>(worklist, {
        slice: (state) => state.worklist,
        newId: (ctx) => (ctx.services.newId ?? (() => crypto.randomUUID()))(),
        now: (ctx) => (ctx.services.now ?? Date.now)(),
        onReceived: notifyNewSurvey,
      }),
      ...createFieldHandlers(),
    ],
    // An OS request opens `tag:<tag>` once the local user may read it with this query.
    selectableResources: { tag: fieldOperations.tagGet.id },
    authorization: fieldPolicy,
    ...(options.services ? { services: options.services } : {}),
    plugins,
    // Captures and done marks go to the hub's own API as this device, through hub-link's client;
    // the hub authorizes every one again. A hub release that changed one of the device assignee
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

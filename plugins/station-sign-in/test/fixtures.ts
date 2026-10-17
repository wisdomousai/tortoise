import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';
import { defineApplication } from '@agent-native/kernel/application';
import { LOCAL_OWNER } from '@agent-native/kernel/authority';
import { defineManifest } from '@agent-native/kernel/manifest';
import { createHandlerFactory } from '@agent-native/runtime';
import { createStationSignInPlugin } from '../src/plugin';
import { stationSignInPluginManifest } from '../src/plugin-manifest';

/** Who the caller is, so a test can tell an operator's session from the seat's. */
export const whoami = defineCapability({
  id: 'work.whoami',
  kind: 'query',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({ principalId: z.string() })),
  permission: { action: 'read', resourceType: 'Work' },
  ui: { exception: 'test fixture' },
});

/** A station application: the owner's screen is the seat, and enrolled operators may read work. */
export function stationApplication(options: { now?: () => number } = {}) {
  const bind = createHandlerFactory<Record<string, never>, {}>();
  return defineApplication<Record<string, never>>({
    manifest: defineManifest({
      id: 'station',
      title: 'Station',
      modules: [defineModule({ id: 'work', capabilities: [whoami] })],
      plugins: [stationSignInPluginManifest],
    }),
    createState: () => ({}),
    handlers: [bind(whoami, async (_input, ctx) => ({ principalId: ctx.context.principalId }))],
    authorization: {
      authorize: ({ context }) => ({
        allowed: context.principalId === LOCAL_OWNER || context.principalId.endsWith('@plant'),
        reason: 'RESOURCE_DENIED',
      }),
      canReadEvent: ({ context }) => context.principalId === LOCAL_OWNER,
    },
    plugins: [createStationSignInPlugin(options)],
  });
}

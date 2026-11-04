import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';
import { defineApplication } from '@tortoise/kernel/application';
import { LOCAL_USER } from '@tortoise/kernel/instance';
import { defineManifest } from '@tortoise/kernel/manifest';
import { createHandlerFactory } from '@tortoise/runtime';
import { createStationSignInPlugin } from '../src/plugin';
import { stationSignInPluginManifest } from '../src/plugin-manifest';

/** Who the caller is, so a test can tell an operator's session from the terminal's. */
export const whoami = defineCapability({
  id: 'work.whoami',
  kind: 'query',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({ principalId: z.string() })),
  permission: { action: 'read', resourceType: 'Work' },
  ui: { exception: 'test fixture' },
});

/** A station application: the local user's screen is the terminal, and enrolled operators may read work. */
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
        allowed: context.principalId === LOCAL_USER || context.principalId.endsWith('@plant'),
        reason: 'RESOURCE_DENIED',
      }),
      canReadEvent: ({ context }) => context.principalId === LOCAL_USER,
    },
    plugins: [createStationSignInPlugin(options)],
  });
}

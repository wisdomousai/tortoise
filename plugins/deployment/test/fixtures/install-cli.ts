import { z } from 'zod';
import { auditPlugin } from '@tortoise/audit/plugin';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';
import { defineApplication } from '@tortoise/host/application';
import { createCli } from '@tortoise/host/cli';
import { defineManifest } from '@tortoise/host/manifest';
import { networkPlugin } from '@tortoise/network/plugin';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { deploymentPlugin } from '../../src/plugin';
import { deploymentPluginManifest } from '../../src/plugin-manifest';

/**
 * A fixture application's CLI, which a test bundle's `bin/` script runs. `FIXTURE_STATE` picks
 * its state version: 1 keeps `count`, 2 renames it to `total`. `counter.send` queues an effect
 * for a `ledger` target that no dispatcher delivers, and `counter.complete` completes it as the
 * target would, so a test can leave work in the outbox and then clear it.
 */
const bump = defineCapability({
  id: 'counter.bump',
  kind: 'command',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Counter' },
  ui: { exception: 'test fixture' },
});
const send = defineCapability({
  id: 'counter.send',
  kind: 'command',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({ effectId: z.string() })),
  permission: { action: 'write', resourceType: 'Counter' },
  ui: { exception: 'test fixture' },
});
const complete = defineCapability({
  id: 'counter.complete',
  kind: 'command',
  input: jsonSchema(z.strictObject({ effectId: z.string() })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Counter' },
  ui: { exception: 'test fixture' },
});
const version = Number(process.env.FIXTURE_STATE ?? '1');
const definition = defineApplication<Record<string, unknown>>({
  manifest: defineManifest({
    id: 'counter-terminal',
    title: 'Counter',
    modules: [defineModule({ id: 'counter', capabilities: [bump, send, complete] })],
    plugins: [deploymentPluginManifest, networkPluginManifest, auditPluginManifest],
  }),
  createState: () => ({ counter: version === 1 ? { count: 0 } : { total: 0 } }),
  ...(version === 2
    ? {
        migrations: {
          version: 2,
          steps: [
            {
              from: 1,
              to: 2,
              up: (state: unknown) => {
                const { counter } = state as { counter: { count: number } };
                return { counter: { total: counter.count } };
              },
            },
          ],
        },
      }
    : {}),
  plugins: [deploymentPlugin, networkPlugin, auditPlugin],
  handlers: [
    {
      capability: bump,
      handle: async (_input, ctx) => {
        const counter = ctx.state.counter as Record<string, number>;
        const key = version === 1 ? 'count' : 'total';
        counter[key] = (counter[key] ?? 0) + 1;
        ctx.change('counter:main');
        return {};
      },
    },
    {
      capability: send,
      handle: async (_input, ctx) => {
        ctx.change('counter:main');
        return {
          effectId: ctx.enqueue({
            target: 'ledger',
            type: 'counter.sent',
            resource: 'counter:main',
            payload: {},
          }),
        };
      },
    },
    {
      capability: complete,
      handle: async (input, ctx) => {
        ctx.completeEffect((input as { effectId: string }).effectId, { status: 'accepted' });
        ctx.change('counter:main');
        return {};
      },
    },
  ],
  authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
});

process.exitCode = await createCli(definition, { program: 'counter-terminal' })(
  process.argv.slice(2),
);

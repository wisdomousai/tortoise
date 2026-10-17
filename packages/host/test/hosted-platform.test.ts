import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';
import { WorkspaceOwnedError } from '@agent-native/adapters/exclusive-lock';
import { pgliteDriver } from '@agent-native/testing/postgres';
import { defineApplication } from '../src/application';
import { startHost } from '../src/host';
import { defineManifest } from '../src/manifest';
import { hostedPlatform } from '../src/platform/hosted';

const count = jsonSchema(z.strictObject({ count: z.number() }));
const bump = defineCapability({
  id: 'counter.bump',
  kind: 'command',
  input: jsonSchema(z.strictObject({})),
  output: count,
  permission: { action: 'write', resourceType: 'Counter' },
  ui: { exception: 'test fixture' },
});
type State = { counter: { count: number } };
const application = defineApplication<State>({
  manifest: defineManifest({
    id: 'counter-app',
    title: 'Counter',
    modules: [defineModule({ id: 'counter', capabilities: [bump] })],
  }),
  createState: () => ({ counter: { count: 0 } }),
  handlers: [
    {
      capability: bump,
      handle: async (_input, ctx) => {
        ctx.state.counter.count += 1;
        ctx.change('counter:main');
        return { count: ctx.state.counter.count };
      },
    },
  ],
  authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
});
const owner = { workspaceId: 'local', principalId: 'owner' };

test('two hosted instances race for one workspace: one serves, the other takes over after it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hosted-'));
  const { database } = pgliteDriver();
  const lost: string[] = [];
  // Each instance has its own local directory and driver, as on two machines.
  const instance = (name: string, leaseMs: number) =>
    hostedPlatform({
      database: pgliteDriver(database),
      workspace: 'plant-7',
      leaseMs,
      onLeaseLost: () => void lost.push(name),
    });
  const start = (name: string, leaseMs: number) =>
    startHost(application, {
      workspacePath: join(directory, name),
      integration: false,
      platform: instance(name, leaseMs),
    });
  try {
    const [first, second] = await Promise.allSettled([start('a', 300), start('b', 300)]);
    const hosts = [first, second].filter((result) => result.status === 'fulfilled');
    expect(hosts).toHaveLength(1);
    const refused = [first, second].find((result) => result.status === 'rejected');
    expect((refused as PromiseRejectedResult).reason).toBeInstanceOf(WorkspaceOwnedError);
    const serving = (hosts[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof start>>>).value;
    const bumpOn = (host: typeof serving) =>
      host.application.invokeRaw({ operation: 'counter.bump', input: {} }, owner);
    expect((await bumpOn(serving)).result).toEqual({ count: 1 });

    // A renewal keeps the lease past its first expiry while the instance runs.
    await Bun.sleep(400);
    await expect(start('c', 300)).rejects.toBeInstanceOf(WorkspaceOwnedError);
    expect((await bumpOn(serving)).result).toEqual({ count: 2 });

    // Closing releases the lease; the next instance starts from the committed state.
    await serving.close();
    const next = await start('c', 10_000);
    expect((await bumpOn(next)).result).toEqual({ count: 3 });
    await next.close();
    expect(lost).toEqual([]);
  } finally {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';
import { createApplicationRuntime, defineApplication } from '@agent-native/host/application';
import { startHost } from '@agent-native/host/host';
import { defineManifest } from '@agent-native/host/manifest';
import { defaultPorts, defineHostPlugin, type NetworkPort } from '@agent-native/host';
import { definePluginManifest } from '@agent-native/host/plugin-manifest';
import { createMemoryStorage, type AuthorizationPort } from '@agent-native/runtime';
import {
  directDriver,
  runScenarios,
  type BehavioralScenario,
} from '@agent-native/testing/scenarios';
import { networkPlugin } from '@agent-native/network/plugin';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePlugin } from '@agent-native/site/plugin';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { webhookOperations } from '../contracts';
import { createWebhookPlugin } from '../plugin';
import { webhookPluginManifest } from '../plugin-manifest';

// A fixture application: notes anyone may add, and a pin that is not observed.
const empty = jsonSchema(z.strictObject({}));
const noteAdd = defineCapability({
  id: 'notes.add',
  kind: 'command',
  input: empty,
  output: empty,
  permission: { action: 'write', resourceType: 'Note' },
  ui: { exception: 'test fixture' },
});
const notePin = defineCapability({ ...noteAdd, id: 'notes.pin' });
const notesModule = defineModule({ id: 'notes', capabilities: [noteAdd, notePin] });
const openPolicy: AuthorizationPort<unknown> = {
  authorize: () => ({ allowed: true }),
  canReadEvent: () => true,
};

/** A network provider that hands posts to `receive` instead of opening sockets. */
function fixtureNetwork(receive: (body: unknown) => Response) {
  const manifest = definePluginManifest({ id: 'fixture-network', title: 'Fixture network' });
  const network: NetworkPort = {
    ...defaultPorts.network,
    client: (destination) => ({
      destination,
      fetch: async (_input, init) => receive(JSON.parse(String(init?.body))),
    }),
  };
  return {
    manifest,
    plugin: defineHostPlugin({ manifest, open: async () => ({ ports: { network } }) }),
  };
}

type Provider = ReturnType<typeof fixtureNetwork>;
/** The framework's network plugin and the site plugin it requires. */
const guarded = [
  { manifest: sitePluginManifest, plugin: sitePlugin },
  { manifest: networkPluginManifest, plugin: networkPlugin },
];

/** The notes application with the webhook plugin, after optional network providers. */
function notesApplication(network?: Provider | readonly Provider[]) {
  const webhook = createWebhookPlugin({ intervalMs: 10, now: () => 1_000 });
  const providers = network === undefined ? [] : 'manifest' in network ? [network] : network;
  return defineApplication<{ notes: { count: number } }>({
    manifest: defineManifest({
      id: 'notes',
      title: 'Notes',
      modules: [notesModule],
      plugins: [...providers.map((provider) => provider.manifest), webhookPluginManifest],
    }),
    createState: () => ({ notes: { count: 0 } }),
    handlers: [noteAdd, notePin].map((capability) => ({
      capability,
      handle: async (
        _input: unknown,
        ctx: { state: { notes: { count: number } }; change(resource: string): void },
      ) => {
        ctx.state.notes.count++;
        ctx.change(`note:${ctx.state.notes.count}`);
        return {};
      },
    })),
    authorization: openPolicy,
    plugins: [...providers.map((provider) => provider.plugin), webhook],
  });
}

const owner = { workspaceId: 'local', principalId: 'owner' };
const settings = { 'webhook-operations': 'notes.add' };

async function withDirectory<T>(use: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), 'webhook-'));
  try {
    return await use(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function until(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await check()) return;
    await Bun.sleep(10);
  }
  throw new Error('Condition not reached');
}

type Status = { cursor: number; delivered: number; failures: number; lastError?: string };
const status = async (host: { application: { queryRaw: Function } }) =>
  (
    (await host.application.queryRaw({ operation: 'webhook.status.get', input: {} }, owner)) as {
      data: Status;
    }
  ).data;

test('observed changes are posted through the network port and the cursor survives a restart', async () => {
  await withDirectory(async (directory) => {
    const posts: { changes: { operation: string; resource: string }[] }[] = [];
    const network = fixtureNetwork((body) => {
      posts.push(body as (typeof posts)[number]);
      return new Response(null, { status: 204 });
    });
    const options = {
      workspacePath: join(directory, 'workspace'),
      integration: false as const,
      settings,
    };
    let host = await startHost(notesApplication(network), options);
    await host.application.invokeRaw({ operation: 'notes.pin', input: {} }, owner);
    await host.application.invokeRaw({ operation: 'notes.add', input: {} }, owner);
    await until(async () => (await status(host)).delivered === 1);
    expect(posts).toHaveLength(1);
    // Only the observed operation, and only ids: no business data leaves.
    expect(posts[0]!.changes.map((change) => [change.operation, change.resource])).toEqual([
      ['notes.add', 'note:2'],
    ]);
    expect(host.plugins).toMatchObject({ webhook: { observing: ['notes.add'] } });
    await host.close();

    host = await startHost(notesApplication(network), options);
    await host.application.invokeRaw({ operation: 'notes.add', input: {} }, owner);
    await until(async () => (await status(host)).delivered === 2);
    // The restarted loop resumed from the recorded cursor and posted only the new change.
    expect(posts.map((post) => post.changes.map((change) => change.resource))).toEqual([
      ['note:2'],
      ['note:3'],
    ]);
    await host.close();
  });
});

test('without a network provider every post is refused and recorded once', async () => {
  await withDirectory(async (directory) => {
    const host = await startHost(notesApplication(), {
      workspacePath: join(directory, 'workspace'),
      integration: false,
      settings,
    });
    try {
      await host.application.invokeRaw({ operation: 'notes.add', input: {} }, owner);
      await until(async () => (await status(host)).failures === 1);
      await Bun.sleep(50);
      const after = await status(host);
      expect(after).toMatchObject({ failures: 1, delivered: 0, cursor: 0 });
      expect(after.lastError).toContain('unreachable');
    } finally {
      await host.close();
    }
  });
});

test('under the network plugin an unbound webhook destination is refused by the egress guard', async () => {
  await withDirectory(async (directory) => {
    const host = await startHost(notesApplication(guarded), {
      workspacePath: join(directory, 'workspace'),
      integration: false,
      settings,
    });
    try {
      await host.application.invokeRaw({ operation: 'notes.add', input: {} }, owner);
      await until(async () => (await status(host)).failures === 1);
      // Isolated by default: the guard refuses the destination it has no binding for.
      expect((await status(host)).lastError).toMatch(/webhook-target/);
    } finally {
      await host.close();
    }
  });
});

test('an unknown operation in the setting refuses startup', async () => {
  await withDirectory(async (directory) => {
    await expect(
      startHost(notesApplication(), {
        workspacePath: join(directory, 'workspace'),
        integration: false,
        settings: { 'webhook-operations': 'notes.delete' },
      }),
    ).rejects.toThrow('unknown operations: notes.delete');
  });
});

const scenarios: BehavioralScenario[] = [
  {
    name: 'readers see status; others are denied; records accumulate',
    async run(driver) {
      await driver.command(
        { operation: webhookOperations.deliveryRecord.id, input: { cursor: 4, delivered: 2 } },
        owner,
      );
      const read = await driver.query(
        { operation: webhookOperations.statusGet.id, input: {} },
        owner,
      );
      expect(read.data).toEqual({
        cursor: 4,
        delivered: 2,
        failures: 0,
        lastDeliveredAt: 1_000,
        observing: [],
      });
      await expect(
        driver.query(
          { operation: webhookOperations.statusGet.id, input: {} },
          { ...owner, principalId: 'guest' },
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  },
];

test('behavioural scenarios through the direct driver', async () => {
  const definition = notesApplication();
  const application = createApplicationRuntime(definition, {
    storage: createMemoryStorage(definition.createState('owner')),
    services: { webhook: { observing: [], now: () => 1_000 } },
  });
  await runScenarios(scenarios, directDriver(application));
});

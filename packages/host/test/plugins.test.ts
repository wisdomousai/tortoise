import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  ApplicationError,
  defineCapability,
  defineHostComponent,
  defineModule,
  failClosedAuditMode,
  jsonSchema,
} from '@tortoise/contracts';
import { createMemoryStorage, type AuthorizationPort } from '@tortoise/runtime';
import { createApplicationRuntime, defineApplication } from '../src/application';
import { openEmbeddedInstance } from '../src/embedded';
import { startHost } from '../src/host';
import { defineManifest } from '../src/manifest';
import { defineHostPlugin, type PluginInstance } from '../src/plugin';
import { definePluginManifest } from '../src/plugin-manifest';
import { openPlugins } from '../src/plugins/lifecycle';
import { readPluginSettings } from '../src/plugins/settings';

const empty = jsonSchema(z.strictObject({}));
const count = jsonSchema(z.strictObject({ count: z.number() }));

// The application: one query over its own slice, readable by anyone.
const notesGet = defineCapability({
  id: 'notes.get',
  kind: 'query',
  input: empty,
  output: count,
  permission: { action: 'read', resourceType: 'Note' },
  ui: { exception: 'test fixture' },
});
const notesModule = defineModule({ id: 'notes', capabilities: [notesGet] });
const openPolicy: AuthorizationPort<unknown> = {
  authorize: () => ({ allowed: true }),
  canReadEvent: () => true,
};

// A plugin: a counter only its listed owners may bump, with its own state slice.
const counterBump = defineCapability({
  id: 'counter.bump',
  kind: 'command',
  input: empty,
  output: count,
  permission: { action: 'write', resourceType: 'Counter' },
  ui: { exception: 'test fixture' },
});
const counterModule = defineModule({ id: 'counter', capabilities: [counterBump] });
const counterComponent = defineHostComponent({
  id: 'counter-client',
  description: 'Fixture plugin component.',
  requirements: {
    network: [
      {
        id: 'counter-sink',
        purpose: 'Fixture destination.',
        direction: 'outbound',
        scope: 'local',
        protocol: 'https',
        dataClasses: ['counter-value'],
        availability: 'optional',
        offline: 'degrade',
      },
    ],
  },
});
const counterManifest = definePluginManifest({
  id: 'counter',
  title: 'Counter',
  modules: [counterModule],
  components: [counterComponent],
  settings: [{ key: 'counter-file', env: 'COUNTER_FILE', kind: 'path', description: 'fixture' }],
});
interface CounterSlice {
  owners: string[];
  count: number;
}
const counterPolicy: AuthorizationPort<CounterSlice> = {
  authorize: ({ context, state }) => ({
    allowed: state.owners.includes(context.principalId),
    reason: 'RESOURCE_DENIED',
  }),
  canReadEvent: () => false,
};

function counterPlugin(open?: () => Promise<PluginInstance>) {
  return defineHostPlugin<CounterSlice>({
    manifest: counterManifest,
    state: { create: (localUserId) => ({ owners: [localUserId], count: 0 }) },
    handlers: [
      {
        capability: counterBump,
        handle: async (_input, ctx) => {
          ctx.state.count++;
          ctx.change('counter:main');
          return { count: ctx.state.count };
        },
      },
    ],
    authorization: { resourceTypes: ['counter'], port: counterPolicy },
    ...(open ? { open } : {}),
  });
}

/** A plugin with no modules that records its lifecycle calls. */
function recorder(
  id: string,
  calls: string[],
  instance: Partial<PluginInstance> = {},
  requires?: string[],
) {
  const manifest = definePluginManifest({ id, title: id });
  return {
    manifest,
    plugin: defineHostPlugin({
      manifest,
      ...(requires ? { requires } : {}),
      async open(context) {
        calls.push(`open ${id} after [${Object.keys(context.services).join(',')}]`);
        return {
          service: { id },
          ready: async () => void calls.push(`ready ${id}`),
          close: async () => void calls.push(`close ${id}`),
          ...instance,
        };
      },
    }),
  };
}

function application(plugins: ReturnType<typeof recorder>[] = [], counter = counterPlugin()) {
  const manifest = defineManifest({
    id: 'notes-app',
    title: 'Notes',
    modules: [notesModule],
    plugins: [counterManifest, ...plugins.map((entry) => entry.manifest)],
  });
  return defineApplication<{ notes: { count: number } }>({
    manifest,
    createState: () => ({ notes: { count: 0 } }),
    // Deliberately returns only its own slice: plugin slices must survive anyway.
    upgradeState: (state) => ({
      notes: ((state as Record<string, unknown>).notes as { count: number }) ?? { count: 0 },
    }),
    handlers: [{ capability: notesGet, handle: async (_input, ctx) => ctx.state.notes }],
    authorization: openPolicy,
    plugins: [counter, ...plugins.map((entry) => entry.plugin)],
  });
}

async function withDirectory<T>(use: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), 'plugins-'));
  try {
    return await use(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('the manifest merges plugin modules and components and refuses collisions', () => {
  const manifest = application().manifest;
  expect(manifest.modules.map((module) => module.id)).toEqual(['notes', 'counter']);
  expect(manifest.components?.map((component) => component.id)).toEqual(['counter-client']);
  expect(() =>
    defineManifest({ id: 'x', title: 'X', modules: [counterModule], plugins: [counterManifest] }),
  ).toThrow('Module "counter" is composed twice');
  expect(() =>
    defineManifest({
      id: 'x',
      title: 'X',
      modules: [],
      plugins: [counterManifest, counterManifest],
    }),
  ).toThrow('Plugin "counter" is composed twice');
});

test('the definition must list the manifest plugins in requires order', () => {
  const calls: string[] = [];
  const first = recorder('first', calls);
  const second = recorder('second', calls, {}, ['first']);
  expect(() => application([second, first])).toThrow('requires "first" composed before it');
  const manifest = defineManifest({ id: 'x', title: 'X', modules: [], plugins: [counterManifest] });
  expect(() =>
    defineApplication({
      manifest,
      createState: () => ({}),
      handlers: [],
      authorization: openPolicy,
    }),
  ).toThrow('do not match');
});

test('plugin slices are created, kept across upgrades and owned only by the plugin', () => {
  const definition = application();
  expect(definition.createState('local-user') as unknown).toEqual({
    notes: { count: 0 },
    counter: { owners: ['local-user'], count: 0 },
  });
  const stored = { notes: { count: 2 }, counter: { owners: ['someone'], count: 7 } };
  expect(definition.upgradeState!(stored, 'local-user') as unknown).toEqual(stored);
  // A workspace from before the plugin was composed gets a fresh slice.
  expect(definition.upgradeState!({ notes: { count: 2 } }, 'local-user') as unknown).toEqual({
    notes: { count: 2 },
    counter: { owners: ['local-user'], count: 0 },
  });
});

test('plugin operations are decided by the plugin policy over its own slice', async () => {
  const definition = application();
  const runtime = createApplicationRuntime(definition, {
    storage: createMemoryStorage(definition.createState('local-user')),
  });
  const localUser = { workspaceId: 'w', principalId: 'local-user' };
  expect(
    (await runtime.invokeRaw({ operation: 'counter.bump', input: {} }, localUser)).result,
  ).toEqual({
    count: 1,
  });
  await expect(
    runtime.invokeRaw(
      { operation: 'counter.bump', input: {} },
      { ...localUser, principalId: 'guest' },
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  // The application's policy still decides its own operations.
  expect(
    (
      await runtime.queryRaw(
        { operation: 'notes.get', input: {} },
        { ...localUser, principalId: 'guest' },
      )
    ).data,
  ).toEqual({ count: 0 });
});

const openOptions = (workspacePath: string) => ({
  workspacePath,
  component: 'embedded' as const,
  instance: 'test',
  serving: false,
});

test('plugins open in order with earlier services and close in reverse', async () => {
  const calls: string[] = [];
  const definition = application([
    recorder('first', calls),
    recorder('second', calls, {}, ['first']),
  ]);
  const plugins = await openPlugins(definition, openOptions('/tmp/unused'));
  expect(plugins.services).toEqual({ first: { id: 'first' }, second: { id: 'second' } });
  await plugins.ready({} as never);
  await plugins.close();
  await plugins.close();
  expect(calls).toEqual([
    'open first after []',
    'open second after [first]',
    'ready first',
    'ready second',
    'close second',
    'close first',
  ]);
});

test('a failed open closes the plugins already opened', async () => {
  const calls: string[] = [];
  const failing = recorder('second', calls);
  const definition = application([
    recorder('first', calls),
    {
      ...failing,
      plugin: defineHostPlugin({
        manifest: failing.manifest,
        open: async () => Promise.reject(new Error('policy unusable')),
      }),
    },
  ]);
  await expect(openPlugins(definition, openOptions('/tmp/unused'))).rejects.toThrow(
    'policy unusable',
  );
  expect(calls).toEqual(['open first after []', 'close first']);
});

test('two providers of one port are refused', async () => {
  const calls: string[] = [];
  const identity = { admit: () => undefined, localUserSessions: false };
  const definition = application([
    recorder('first', calls, { ports: { identity } }),
    recorder('second', calls, { ports: { identity } }),
  ]);
  await expect(openPlugins(definition, openOptions('/tmp/unused'))).rejects.toThrow(
    'Plugins "first" and "second" both provide the identity port',
  );
  expect(calls).toContain('close first');
});

test('a port a plugin needs must be provided by a composed plugin', async () => {
  const calls: string[] = [];
  const needy = recorder('needy', calls, { needs: ['eventLog'] });
  await expect(openPlugins(application([needy]), openOptions('/tmp/unused'))).rejects.toThrow(
    'Plugin "needy" is configured to need the eventLog port, but no composed plugin provides it',
  );
  expect(calls).toEqual(['open needy after []', 'close needy']);
  const eventLog = { mode: failClosedAuditMode, append: async () => [] };
  const provider = recorder('log', [], { ports: { eventLog } });
  const plugins = await openPlugins(application([provider, needy]), openOptions('/tmp/unused'));
  expect(plugins.ports.eventLog).toBe(eventLog);
  await plugins.close();
});

test('plugins see the composed ports once every plugin has opened', async () => {
  let early: unknown;
  let late: unknown;
  const identity = { admit: () => undefined, localUserSessions: false };
  const consumerManifest = definePluginManifest({ id: 'consumer', title: 'consumer' });
  const consumer = defineHostPlugin({
    manifest: consumerManifest,
    async open(context) {
      try {
        void context.ports.identity;
      } catch (error) {
        early = (error as Error).message;
      }
      return { ready: async () => void (late = context.ports.identity) };
    },
  });
  const provider = recorder('provider', [], { ports: { identity } });
  const definition = application([{ manifest: consumerManifest, plugin: consumer }, provider]);
  const plugins = await openPlugins(definition, openOptions('/tmp/unused'));
  await plugins.ready({} as never);
  expect(early).toBe('Host ports are available once every plugin has opened');
  // Provided by a plugin opened after the consumer, yet visible to it.
  expect(late).toBe(identity);
  await plugins.close();
});

test('without providers the kernel reaches nothing and keeps no audit log', async () => {
  const plugins = await openPlugins(application(), openOptions('/tmp/unused'));
  expect(plugins.ports.eventLog).toBeUndefined();
  await expect(
    plugins.ports.network.routedFetch(['counter-sink'])('https://example.test'),
  ).rejects.toBeInstanceOf(ApplicationError);
  await expect(plugins.ports.network.client('counter-sink').fetch('/')).rejects.toMatchObject({
    code: 'UNAVAILABLE',
  });
  await expect(plugins.ports.network.socket!('counter-sink', {} as never)).rejects.toMatchObject({
    code: 'UNAVAILABLE',
  });
  expect(() => plugins.ports.network.childEnvironment!('child')).toThrow('unreachable');
  expect(plugins.ports.identity.localUserSessions).toBe(true);
  expect(() => plugins.ports.identity.admit(undefined)).not.toThrow();
});

test('settings reach only the plugin that declares them; unclaimed settings refuse to start', async () => {
  let seen: Readonly<Record<string, string>> | undefined;
  const definition = application(
    [],
    counterPlugin(async () => ({})),
  );
  const withOpen = application(
    [],
    defineHostPlugin<CounterSlice>({
      ...counterPlugin(),
      open: async (context) => {
        seen = context.settings;
        return {};
      },
    }),
  );
  await openPlugins(withOpen, {
    ...openOptions('/tmp/unused'),
    settings: { 'counter-file': '/a' },
  });
  expect(seen).toEqual({ 'counter-file': '/a' });
  await expect(
    openPlugins(definition, {
      ...openOptions('/tmp/unused'),
      settings: { 'deployment-policy': '/p' },
    }),
  ).rejects.toThrow('No composed plugin reads the setting "deployment-policy"');
});

test('settings come from flags before env; undeclared flags stay for the command to refuse', () => {
  const manifest = application().manifest;
  const args = ['--counter-file', 'rel/file', '--deployment-policy', 'x'];
  expect(readPluginSettings(manifest, { COUNTER_FILE: '/env' }, args)).toEqual({
    'counter-file': resolve('rel/file'),
  });
  expect(args).toEqual(['--deployment-policy', 'x']);
  expect(readPluginSettings(manifest, { COUNTER_FILE: '/env' })).toEqual({
    'counter-file': '/env',
  });
});

test('an embedded instance runs ready before the first call and exposes plugin services', async () => {
  await withDirectory(async (directory) => {
    const calls: string[] = [];
    const instance = await openEmbeddedInstance(application([recorder('first', calls)]), {
      workspacePath: join(directory, 'workspace'),
    });
    expect(calls).toEqual(['open first after []', 'ready first']);
    expect(instance.services).toEqual({ first: { id: 'first' } });
    await instance.close();
    expect(calls.at(-1)).toBe('close first');
  });
});

test('a serving host starts plugins as a delegated caller and stops their observers', async () => {
  await withDirectory(async (directory) => {
    const calls: string[] = [];
    let principal: string | undefined;
    const started = recorder('first', calls, {
      async start(context) {
        const caller = context.delegate({ operations: ['counter.bump'] });
        principal = caller.principalId;
        const receipt = await context.application.invokeRaw(
          { operation: 'counter.bump', input: {} },
          caller,
        );
        calls.push(`bumped ${(receipt.result as { count: number }).count}`);
        await expect(
          context.application.queryRaw({ operation: 'notes.get', input: {} }, caller),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        return [{ stop: async () => void calls.push('observer stopped') }];
      },
    });
    const host = await startHost(application([started]), {
      workspacePath: join(directory, 'workspace'),
      integration: false,
    });
    expect(principal).toBe('local-user');
    expect(host.url).toStartWith('http://127.0.0.1:');
    expect(host.plugins).toEqual({ counter: {}, first: {} });
    await host.close();
    expect(calls.slice(-3)).toEqual(['bumped 1', 'observer stopped', 'close first']);
  });
});

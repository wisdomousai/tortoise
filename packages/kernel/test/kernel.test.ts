import { expect, test } from 'bun:test';
import { z } from 'zod';
import {
  ApplicationError,
  defineCapability,
  defineHostComponent,
  defineModule,
  jsonSchema,
  type Requirements,
} from '@agent-native/contracts';
import type { AuthorizationPort } from '@agent-native/runtime';
import { defineApplication } from '../src/application';
import { LOCAL_OWNER, LOCAL_WORKSPACE, openAuthority } from '../src/authority';
import { defineManifest } from '../src/manifest';
import { defineHostPlugin, type HostPlugin, type PluginInstance } from '../src/plugin';
import { definePluginManifest, type PlatformId, type PluginSetting } from '../src/plugin-manifest';
import { fakePlatform } from './fake-platform';

const empty = jsonSchema(z.strictObject({}));
const count = jsonSchema(z.strictObject({ count: z.number() }));
const tallyBump = defineCapability({
  id: 'tally.bump',
  kind: 'command',
  input: empty,
  output: count,
  permission: { action: 'write', resourceType: 'Tally' },
  ui: { exception: 'test fixture' },
});
const tallyGet = defineCapability({
  id: 'tally.get',
  kind: 'query',
  input: empty,
  output: count,
  permission: { action: 'read', resourceType: 'Tally' },
  ui: { exception: 'test fixture' },
});
const tallyModule = defineModule({ id: 'tally', capabilities: [tallyBump, tallyGet] });
const openPolicy: AuthorizationPort<unknown> = {
  authorize: () => ({ allowed: true }),
  canReadEvent: () => true,
};
const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };

/** A plugin with no modules that runs where `platforms` says and records its lifecycle. */
function plugin(
  id: string,
  options: {
    platforms?: readonly PlatformId[];
    calls?: string[];
    settings?: readonly PluginSetting[];
    requirements?: Requirements;
    instance?: Partial<PluginInstance>;
    provideSettings?: HostPlugin['provideSettings'];
  } = {},
) {
  const manifest = definePluginManifest({
    id,
    title: id,
    ...(options.platforms ? { platforms: options.platforms } : {}),
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.requirements
      ? {
          components: [
            defineHostComponent({
              id: `${id}-component`,
              description: 'fixture',
              requirements: options.requirements,
            }),
          ],
        }
      : {}),
  });
  return defineHostPlugin({
    manifest,
    ...(options.provideSettings ? { provideSettings: options.provideSettings } : {}),
    async open(context) {
      options.calls?.push(`open ${id} ${JSON.stringify(context.settings)}`);
      return {
        close: async () => void options.calls?.push(`close ${id}`),
        ...options.instance,
      };
    },
  });
}

function application(plugins: ReturnType<typeof plugin>[] = []) {
  return defineApplication<{ tally: { count: number } }>({
    manifest: defineManifest({
      id: 'tally-app',
      title: 'Tally',
      modules: [tallyModule],
      plugins: plugins.map((entry) => entry.manifest),
    }),
    createState: () => ({ tally: { count: 0 } }),
    handlers: [
      {
        capability: tallyBump,
        handle: async (_input, ctx) => {
          ctx.state.tally.count++;
          ctx.change('tally:main');
          return { count: ctx.state.tally.count };
        },
      },
      { capability: tallyGet, handle: async (_input, ctx) => ctx.state.tally },
    ],
    authorization: openPolicy,
    plugins,
  });
}

async function open(
  definition: ReturnType<typeof application>,
  fake: ReturnType<typeof fakePlatform>,
  extra: { settings?: Record<string, string>; launcherSettingsWin?: boolean } = {},
) {
  const ownership = await fake.platform.acquireOwnership('/workspace');
  try {
    const authority = await openAuthority(definition, {
      platform: fake.platform,
      ownership,
      component: 'embedded',
      serving: false,
      ...extra,
    });
    return { authority, ownership };
  } catch (error) {
    await ownership.release();
    throw error;
  }
}

test('an authority opens on a platform without Node or Bun and keeps state across reopen', async () => {
  const fake = fakePlatform();
  const calls: string[] = [];
  const definition = application([plugin('field', { platforms: ['android', 'ios'], calls })]);
  const first = await open(definition, fake);
  const receipt = await first.authority.application.invokeRaw(
    { operation: 'tally.bump', input: {}, idempotencyKey: 'bump-1' },
    owner,
  );
  expect(receipt.result).toEqual({ count: 1 });
  // One writer: the workspace cannot be owned twice while open.
  await expect(fake.platform.acquireOwnership('/workspace')).rejects.toThrow('owned');
  await first.authority.close();
  await first.ownership.release();
  expect(calls).toEqual(['open field {}', 'close field']);
  expect(fake.events).toEqual(['open storage /workspace', 'close storage /workspace']);

  const second = await open(definition, fake);
  const read = await second.authority.application.queryRaw(
    { operation: 'tally.get', input: {} },
    owner,
  );
  expect(read.data).toEqual({ count: 1 });
  // The runtime's catalog lists only what this platform's host declares, here nothing.
  expect(second.authority.application.discover(owner).requirements.network).toEqual([]);
  await second.authority.close();
  await second.ownership.release();
});

test('a plugin is refused on a platform it does not list; no platforms means Bun only', async () => {
  const calls: string[] = [];
  const android = fakePlatform({ id: 'android' });
  await expect(open(application([plugin('desktop-only', { calls })]), android)).rejects.toThrow(
    'Plugin "desktop-only" does not run on platform "android"',
  );
  await expect(
    open(application([plugin('phone', { platforms: ['ios'], calls })]), android),
  ).rejects.toThrow('Plugin "phone" does not run on platform "android"');
  // Refused before anything opened, and ownership is free again.
  expect(calls).toEqual([]);
  expect(android.events).toEqual([]);
  expect(android.held.size).toBe(0);
  const bun = fakePlatform({ id: 'bun' });
  const { authority, ownership } = await open(application([plugin('desktop-only')]), bun);
  await authority.close();
  await ownership.release();
});

test('requirements the platform cannot meet are refused before any plugin opens', async () => {
  const destination = {
    purpose: 'fixture',
    scope: 'site',
    dataClasses: ['reading'],
    availability: 'optional',
    offline: 'degrade',
  } as const;
  const cases: [Requirements, string][] = [
    [
      { network: [{ ...destination, id: 'plc', direction: 'egress', protocol: 'tcp' }] },
      'plc needs sockets',
    ],
    [
      { network: [{ ...destination, id: 'listener', direction: 'ingress', protocol: 'https' }] },
      'listener needs ingress',
    ],
    [
      {
        processes: [{ id: 'helper', executable: 'helper', purpose: 'x', availability: 'optional' }],
      },
      'helper needs child-process',
    ],
  ];
  for (const [requirements, message] of cases) {
    const calls: string[] = [];
    const fake = fakePlatform();
    await expect(
      open(application([plugin('needy', { platforms: ['android'], requirements, calls })]), fake),
    ).rejects.toThrow(message);
    expect(calls).toEqual([]);
  }
  // The same deployment opens where the capability exists.
  const capable = fakePlatform({ capabilities: ['sockets'] });
  const { authority, ownership } = await open(
    application([plugin('needy', { platforms: ['android'], requirements: cases[0]![0] })]),
    capable,
  );
  await authority.close();
  await ownership.release();
});

test('settings providers supply other plugins settings before any plugin opens', async () => {
  const calls: string[] = [];
  const hubUrl: PluginSetting = {
    key: 'hub-url',
    env: 'HUB_URL',
    kind: 'string',
    description: 'fixture',
  };
  const provider = (settings: Record<string, string>) =>
    plugin('managed', {
      platforms: ['android'],
      calls,
      provideSettings: async (context) => {
        calls.push(`provide ${context.platform.id}`);
        return settings;
      },
    });
  const consumer = plugin('link', { platforms: ['android'], calls, settings: [hubUrl] });

  // Provided settings win over the launcher's by default.
  let opened = await open(
    application([provider({ 'hub-url': 'https://hub' }), consumer]),
    fakePlatform(),
    {
      settings: { 'hub-url': 'https://launcher' },
    },
  );
  expect(calls).toEqual([
    'provide android',
    'open managed {}',
    'open link {"hub-url":"https://hub"}',
  ]);
  await opened.authority.close();

  // A development build lets the launcher override them.
  calls.length = 0;
  opened = await open(
    application([provider({ 'hub-url': 'https://hub' }), consumer]),
    fakePlatform(),
    {
      settings: { 'hub-url': 'https://launcher' },
      launcherSettingsWin: true,
    },
  );
  expect(calls).toContain('open link {"hub-url":"https://launcher"}');
  await opened.authority.close();

  // A provided key no plugin declares is refused like a launcher one.
  calls.length = 0;
  await expect(
    open(application([provider({ 'site-policy': 'x' }), consumer]), fakePlatform()),
  ).rejects.toThrow('No composed plugin reads the setting "site-policy"');
  expect(calls).toEqual(['provide android']);
});

test('two providers of one setting are a composition error', async () => {
  const setting: PluginSetting = {
    key: 'hub-url',
    env: 'HUB_URL',
    kind: 'string',
    description: 'x',
  };
  const providing = (id: string) =>
    plugin(id, { platforms: ['android'], provideSettings: async () => ({ 'hub-url': id }) });
  await expect(
    open(
      application([
        providing('first'),
        providing('second'),
        plugin('link', { platforms: ['android'], settings: [setting] }),
      ]),
      fakePlatform(),
    ),
  ).rejects.toThrow('Plugins "first" and "second" both provide the setting "hub-url"');
});

test('a failing ready hook closes storage and plugins; the caller keeps ownership', async () => {
  const calls: string[] = [];
  const fake = fakePlatform();
  const failing = plugin('attest', {
    platforms: ['android'],
    calls,
    instance: {
      ready: async () => {
        throw new Error('attestation failed');
      },
    },
  });
  const ownership = await fake.platform.acquireOwnership('/workspace');
  await expect(
    openAuthority(application([failing]), {
      platform: fake.platform,
      ownership,
      component: 'embedded',
      serving: false,
    }),
  ).rejects.toThrow('attestation failed');
  expect(fake.events).toEqual(['open storage /workspace', 'close storage /workspace']);
  expect(calls).toEqual(['open attest {}', 'close attest']);
  expect(fake.held.has('/workspace')).toBe(true);
  await ownership.release();
});

test('a platform without a listener refuses listening unless a plugin provides ingress', async () => {
  const { authority, ownership } = await open(application(), fakePlatform());
  expect(() => authority.ports.ingress.listen(0, () => new Response())).toThrow(ApplicationError);
  expect(authority.ports.network.socket).toBeDefined();
  await authority.close();
  await ownership.release();
});

test('application targets must be known and every plugin must run on each', () => {
  const phone = definePluginManifest({ id: 'phone', title: 'Phone', platforms: ['android'] });
  const desktop = definePluginManifest({ id: 'desktop', title: 'Desktop' });
  expect(
    defineManifest({
      id: 'field',
      title: 'Field',
      modules: [],
      plugins: [phone],
      targets: ['mobile'],
    }).targets,
  ).toEqual(['mobile']);
  expect(() =>
    defineManifest({
      id: 'field',
      title: 'Field',
      modules: [],
      plugins: [desktop],
      targets: ['mobile'],
    }),
  ).toThrow('Plugin "desktop" does not run on target "mobile"');
  expect(() =>
    defineManifest({
      id: 'field',
      title: 'Field',
      modules: [],
      plugins: [phone],
      targets: ['desktop'],
    }),
  ).toThrow('Plugin "phone" does not run on target "desktop"');
  expect(() =>
    defineManifest({ id: 'field', title: 'Field', modules: [], targets: ['watch' as 'web'] }),
  ).toThrow('Unknown application target "watch"');
  expect(() =>
    defineManifest({ id: 'field', title: 'Field', modules: [], targets: ['web', 'web'] }),
  ).toThrow('Target "web" is listed twice');
  expect(() => definePluginManifest({ id: 'p', title: 'P', platforms: ['wasm' as 'bun'] })).toThrow(
    'unknown platform "wasm"',
  );
  expect(() => definePluginManifest({ id: 'p', title: 'P', platforms: [] })).toThrow(
    'lists no platform',
  );
});

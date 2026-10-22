import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  defineCapability,
  defineFeatureManifest,
  defineModule,
  jsonSchema,
} from '@agent-native/contracts';
import { SQLiteStorage } from '@agent-native/adapters/sqlite';
import {
  createMemoryStorage,
  definePolicy,
  type AuthorizationPort,
  type RemoteSource,
} from '@agent-native/runtime';
import { createApplicationRuntime, defineApplication } from '../src/application';
import { LOCAL_OWNER, LOCAL_WORKSPACE, openEmbeddedInstance } from '../src/embedded';
import { defineFeature, mountFeature, type FeatureAdoption } from '../src/feature';
import { defineManifest } from '../src/manifest';
import { defineHostPlugin } from '../src/plugin';
import { definePluginManifest } from '../src/plugin-manifest';

const empty = jsonSchema(z.strictObject({}));
const fixture = { ui: { exception: 'test fixture' } } as const;

// The application: members and a log the feature's hook writes to.
const memberAdd = defineCapability({
  id: 'member.add',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string() })),
  output: empty,
  permission: { action: 'write', resourceType: 'Member' },
  ...fixture,
});
const memberModule = defineModule({ id: 'member', capabilities: [memberAdd] });
type Root = { members: string[]; log: string[]; legacy?: number; tally?: { total: number } };

// The feature: a tally only members may add to, with a hook the application implements.
const tallyAdd = defineCapability({
  id: 'tally.add',
  kind: 'command',
  input: jsonSchema(z.strictObject({ by: z.number() })),
  output: jsonSchema(z.strictObject({ total: z.number() })),
  permission: { action: 'add', resourceType: 'Tally' },
  ...fixture,
});
const tallyRead = defineCapability({
  id: 'tally.read',
  kind: 'query',
  input: empty,
  output: jsonSchema(z.strictObject({ total: z.number() })),
  permission: { action: 'read', resourceType: 'Tally' },
  ...fixture,
});
const tallyManifest = defineFeatureManifest({
  id: 'tally',
  title: 'Tally',
  modules: [defineModule({ id: 'tally', capabilities: [tallyAdd, tallyRead] })],
});
type Slice = { total: number };
type Access = { member(principalId: string): boolean };
type Hooks = { added?(total: number): void };
const tallyFeature = defineFeature<Slice, Access, Hooks>({
  manifest: tallyManifest,
  state: { create: () => ({ total: 0 }), migrations: { version: 1 } },
  handlers: [
    {
      capability: tallyAdd,
      handle: (input, ctx) => {
        ctx.state.total += (input as { by: number }).by;
        ctx.change('tally:main');
        ctx.hooks.added?.(ctx.state.total);
        return { total: ctx.state.total };
      },
    },
    { capability: tallyRead, handle: (_input, ctx) => ({ total: ctx.state.total }) },
  ],
  authorization: {
    resourceTypes: ['tally'],
    port: {
      authorize: ({ access, context }) => ({
        allowed: access.member(context.principalId),
        reason: 'NOT_A_MEMBER',
      }),
      canReadEvent: ({ access, context }) => access.member(context.principalId),
    },
  },
});

const applicationPolicy = definePolicy<Root>({
  operations: { [memberAdd.id]: 'open' },
  events: { member: () => true },
});
const tallyMount = (adopt?: FeatureAdoption) =>
  mountFeature<Root, Access, Hooks>(tallyFeature, {
    access: (state) => ({ member: (id) => state.members.includes(id) }),
    hooks: {
      added: (total, ctx) => {
        ctx.state.log.push(`tally ${total}`);
      },
    },
    ...(adopt ? { adopt } : {}),
  });
const manifest = defineManifest({
  id: 'tally-app',
  title: 'Tally',
  modules: [memberModule],
  features: [tallyManifest],
});
function application(
  overrides: Partial<Parameters<typeof defineApplication<Root>>[0]> = {},
  mount = tallyMount(),
) {
  return defineApplication<Root>({
    manifest,
    createState: () => ({ members: ['owner'], log: [] }),
    handlers: [
      {
        capability: memberAdd,
        handle: (input, ctx) => {
          ctx.state.members.push((input as { id: string }).id);
          ctx.change(`member:${(input as { id: string }).id}`);
          return {};
        },
      },
    ],
    authorization: applicationPolicy,
    features: [mount],
    ...overrides,
  });
}
const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };
const stranger = { workspaceId: LOCAL_WORKSPACE, principalId: 'stranger' };

async function withDirectory<T>(use: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), 'features-'));
  try {
    return await use(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('feature manifests', () => {
  test('modules merge as application, features, plugins', () => {
    const plugin = definePluginManifest({
      id: 'counter',
      title: 'Counter',
      modules: [defineModule({ id: 'counter', capabilities: [] })],
    });
    const merged = defineManifest({
      id: 'x',
      title: 'X',
      modules: [memberModule],
      features: [tallyManifest],
      plugins: [plugin],
    });
    expect(merged.modules.map((module) => module.id)).toEqual(['member', 'tally', 'counter']);
  });

  test('ids, namespaces and requires are checked', () => {
    const sameId = definePluginManifest({ id: 'tally', title: 'Tally plugin' });
    expect(() =>
      defineManifest({
        id: 'x',
        title: 'X',
        modules: [],
        features: [tallyManifest],
        plugins: [sameId],
      }),
    ).toThrow('Feature and plugin "tally" share an id');
    expect(() =>
      defineManifest({
        id: 'x',
        title: 'X',
        modules: [],
        features: [tallyManifest, tallyManifest],
      }),
    ).toThrow('Feature "tally" is mounted twice');
    const intruder = defineModule({
      id: 'own',
      capabilities: [defineCapability({ ...tallyAdd, id: 'tally.reset' })],
    });
    expect(() =>
      defineManifest({ id: 'x', title: 'X', modules: [intruder], features: [tallyManifest] }),
    ).toThrow('Application operation tally.reset is in the namespace of "tally"');
    const linked = definePluginManifest({
      id: 'linked',
      title: 'Linked',
      namespace: 'tally',
      modules: [
        defineModule({
          id: 'linked',
          capabilities: [defineCapability({ ...tallyAdd, id: 'tally.link' })],
        }),
      ],
    });
    expect(() =>
      defineManifest({
        id: 'x',
        title: 'X',
        modules: [],
        features: [tallyManifest],
        plugins: [linked],
      }),
    ).toThrow('share the operation namespace "tally"');
    const dependent = defineFeatureManifest({ id: 'report', title: 'Report', requires: ['tally'] });
    expect(() =>
      defineManifest({ id: 'x', title: 'X', modules: [], features: [dependent, tallyManifest] }),
    ).toThrow('Feature "report" requires "tally" mounted before it');
    expect(() =>
      definePluginManifest({
        id: 'loose',
        title: 'Loose',
        modules: [defineModule({ id: 'loose', capabilities: [tallyAdd] })],
      }),
    ).toThrow('outside its namespace "loose."');
  });

  test('a feature is refused with resource types or sources it does not own', () => {
    expect(() =>
      defineFeature({
        manifest: tallyManifest,
        handlers: [],
        authorization: { resourceTypes: ['counter'], port: tallyFeature.authorization!.port },
      }),
    ).toThrow('resource type "counter"');
    expect(() =>
      defineFeature({
        manifest: defineFeatureManifest({ id: 'empty', title: 'Empty' }),
        sources: { crm: {} as RemoteSource },
      }),
    ).toThrow('source for "crm"');
  });
});

describe('feature composition', () => {
  test('the feature slice, access view, hooks and policy compose into one transaction', async () => {
    const definition = application();
    const storage = createMemoryStorage<Root>(definition.createState('owner'));
    const runtime = createApplicationRuntime(definition, { storage: storage as never });
    expect(await storage.read(LOCAL_WORKSPACE, async (s) => s.state)).toEqual({
      members: ['owner'],
      log: [],
      tally: { total: 0 },
    });
    await expect(
      runtime.invokeRaw({ operation: 'tally.add', input: { by: 1 } }, stranger),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await runtime.invokeRaw({ operation: 'member.add', input: { id: 'stranger' } }, owner);
    await runtime.invokeRaw({ operation: 'tally.add', input: { by: 3 } }, stranger);
    expect(await storage.read(LOCAL_WORKSPACE, async (s) => s.state)).toEqual({
      members: ['owner', 'stranger'],
      log: ['tally 3'],
      tally: { total: 3 },
    });
    const events = await runtime.events(0, { workspaceId: LOCAL_WORKSPACE, principalId: 'nobody' });
    expect(events.events.map((event) => event.resource)).toEqual(['member:stranger']);
  });

  test('composition refuses mismatched lists, shadowed rules and service collisions', () => {
    expect(() => application({ features: [] })).toThrow(
      "Application features [] do not match its manifest's [tally]",
    );
    expect(() =>
      application({
        authorization: definePolicy<Root>({
          operations: { [memberAdd.id]: 'open', [tallyAdd.id]: 'open' },
          events: {},
        }),
      }),
    ).toThrow('The application policy has a rule for tally.add');
    expect(() =>
      application({
        authorization: definePolicy<Root>({
          operations: { [memberAdd.id]: 'open' },
          events: { tally: () => true },
        }),
      }),
    ).toThrow('Resource type "tally" has an application event rule');
    expect(() => application({ services: { tally: {} } as never })).toThrow(
      'Application services already have a "tally" key',
    );
    expect(() =>
      application({
        createState: () => ({ members: [], log: [], tally: { total: 9 } }),
      }).createState('o'),
    ).toThrow('Application state already has a "tally" key');
  });

  test('a plugin resource type cannot shadow an application event rule', () => {
    const counterManifest = definePluginManifest({
      id: 'counter',
      title: 'Counter',
      modules: [defineModule({ id: 'counter', capabilities: [] })],
    });
    const open: AuthorizationPort<unknown> = {
      authorize: () => ({ allowed: true }),
      canReadEvent: () => true,
    };
    expect(() =>
      defineApplication<Root>({
        manifest: defineManifest({
          id: 'x',
          title: 'X',
          modules: [memberModule],
          plugins: [counterManifest],
        }),
        createState: () => ({ members: [], log: [] }),
        handlers: [{ capability: memberAdd, handle: () => ({}) }],
        authorization: definePolicy<Root>({
          operations: { [memberAdd.id]: 'open' },
          events: { member: () => true },
        }),
        plugins: [
          defineHostPlugin({
            manifest: counterManifest,
            handlers: [],
            authorization: { resourceTypes: ['member'], port: open },
          }),
        ],
      }),
    ).toThrow('Resource type "member" has an application event rule');
  });

  test('feature connections merge with the application and bind their sources', async () => {
    const source: RemoteSource = { search: async () => ({ items: [], identity: 'service' }) };
    const feature = defineFeature<Slice, Access, Hooks>({
      ...tallyFeature,
      connect: () => ({ sources: { tally: source } }),
    });
    let observed = false;
    const definition = application(
      { connect: () => ({ observe: async () => ((observed = true), []) }) },
      mountFeature<Root, Access, Hooks>(feature, {
        access: (state) => ({ member: (id) => state.members.includes(id) }),
      }),
    );
    const connections = definition.connect!({} as never);
    await connections.observe?.(() => undefined);
    expect(observed).toBe(true);
    expect(connections.sources).toEqual({ tally: source });
    const runtime = createApplicationRuntime(definition, {
      storage: createMemoryStorage<Root>(definition.createState('owner')) as never,
    });
    runtime.bindSources(connections.sources!);
    expect(() => runtime.bindSources({ tally: source })).toThrow(
      'Source for "tally" is bound twice',
    );
  });
});

describe('feature state', () => {
  const v2 = {
    version: 2,
    steps: [
      {
        from: 1,
        to: 2,
        up: (state: unknown) => {
          const { legacy: _moved, ...rest } = state as Root;
          return rest;
        },
      },
    ],
  };
  const adopt: FeatureAdoption = {
    before: 2,
    from: (stored) => ({ total: (stored as Root).legacy ?? 0 }),
  };
  const legacy = application({
    createState: () => ({ members: ['owner'], log: [], legacy: 0 }),
    features: [],
    manifest: defineManifest({ id: 'tally-app', title: 'Tally', modules: [memberModule] }),
    authorization: applicationPolicy,
  });

  async function stored(workspacePath: string) {
    const raw = new SQLiteStorage<Root>(join(workspacePath, 'workspace.sqlite'), () => ({
      members: [],
      log: [],
    }));
    try {
      return await raw.read(LOCAL_WORKSPACE, async (snapshot) => structuredClone(snapshot));
    } finally {
      await raw.close();
    }
  }

  test('a new workspace stamps the feature slice under feature:<id>', async () => {
    await withDirectory(async (workspacePath) => {
      const instance = await openEmbeddedInstance(
        application({ migrations: v2 }, tallyMount(adopt)),
        {
          workspacePath,
        },
      );
      await instance.application.invokeRaw({ operation: 'tally.add', input: { by: 1 } }, owner);
      await instance.close();
      const snapshot = await stored(workspacePath);
      expect(snapshot.state.tally).toEqual({ total: 1 });
      expect(snapshot.stateVersions).toEqual({
        application: { version: 2, readableFrom: 2 },
        'feature:tally': { version: 1, readableFrom: 1 },
      });
    });
  });

  test('legacy data is adopted into the slice once, and old code refuses the result', async () => {
    await withDirectory(async (workspacePath) => {
      // Version 1 kept the tally in the application's own `legacy` field.
      const old = await openEmbeddedInstance(legacy, { workspacePath });
      await old.application.invokeRaw({ operation: 'member.add', input: { id: 'ann' } }, owner);
      await old.close();
      const raw = new SQLiteStorage<Root>(join(workspacePath, 'workspace.sqlite'), () => ({
        members: [],
        log: [],
      }));
      await raw.transact(LOCAL_WORKSPACE, async (snapshot) => {
        snapshot.state.legacy = 5;
      });
      await raw.close();

      const upgraded = application({ migrations: v2 }, tallyMount(adopt));
      for (const by of [1, 1]) {
        const instance = await openEmbeddedInstance(upgraded, { workspacePath });
        await instance.application.invokeRaw({ operation: 'tally.add', input: { by } }, owner);
        await instance.close();
      }
      const snapshot = await stored(workspacePath);
      expect(snapshot.state).toEqual({
        members: ['owner', 'ann'],
        log: ['tally 6', 'tally 7'],
        tally: { total: 7 },
      });
      expect(snapshot.stateVersions?.['feature:tally']).toEqual({ version: 1, readableFrom: 1 });
      const refused = await openEmbeddedInstance(legacy, { workspacePath });
      try {
        await expect(
          refused.application.invokeRaw({ operation: 'member.add', input: { id: 'bo' } }, owner),
        ).rejects.toThrow('needs code at version 2');
      } finally {
        await refused.close();
      }
    });
  });

  test('an adoption needs an incompatible application step to its version', () => {
    expect(() => application({}, tallyMount(adopt))).toThrow(
      'no incompatible application migration step reaches',
    );
    expect(() =>
      application(
        { migrations: { version: 2, steps: [{ ...v2.steps[0]!, compatible: true }] } },
        tallyMount(adopt),
      ),
    ).toThrow('no incompatible application migration step reaches');
  });
});

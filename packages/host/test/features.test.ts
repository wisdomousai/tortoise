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
type Root = { members: string[]; log: string[]; legacy?: number; score?: { total: number } };

// The feature: a score only members may add to, with a hook the application implements.
const scoreAdd = defineCapability({
  id: 'score.add',
  kind: 'command',
  input: jsonSchema(z.strictObject({ by: z.number() })),
  output: jsonSchema(z.strictObject({ total: z.number() })),
  permission: { action: 'add', resourceType: 'Score' },
  ...fixture,
});
const scoreRead = defineCapability({
  id: 'score.read',
  kind: 'query',
  input: empty,
  output: jsonSchema(z.strictObject({ total: z.number() })),
  permission: { action: 'read', resourceType: 'Score' },
  ...fixture,
});
const scoreManifest = defineFeatureManifest({
  id: 'score',
  title: 'Score',
  modules: [defineModule({ id: 'score', capabilities: [scoreAdd, scoreRead] })],
});
type Slice = { total: number };
type Access = { member(principalId: string): boolean };
type Hooks = { added?(total: number): void };
const scoreFeature = defineFeature<Slice, Access, Hooks>({
  manifest: scoreManifest,
  state: { create: () => ({ total: 0 }), migrations: { version: 1 } },
  handlers: [
    {
      capability: scoreAdd,
      handle: (input, ctx) => {
        ctx.state.total += (input as { by: number }).by;
        ctx.change('score:main');
        ctx.hooks.added?.(ctx.state.total);
        return { total: ctx.state.total };
      },
    },
    { capability: scoreRead, handle: (_input, ctx) => ({ total: ctx.state.total }) },
  ],
  authorization: {
    resourceTypes: ['score'],
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
const scoreMount = (adopt?: FeatureAdoption) =>
  mountFeature<Root, Access, Hooks>(scoreFeature, {
    access: (state) => ({ member: (id) => state.members.includes(id) }),
    hooks: {
      added: (total, ctx) => {
        ctx.state.log.push(`score ${total}`);
      },
    },
    ...(adopt ? { adopt } : {}),
  });
const manifest = defineManifest({
  id: 'score-app',
  title: 'Score',
  modules: [memberModule],
  features: [scoreManifest],
});
function application(
  overrides: Partial<Parameters<typeof defineApplication<Root>>[0]> = {},
  mount = scoreMount(),
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
      features: [scoreManifest],
      plugins: [plugin],
    });
    expect(merged.modules.map((module) => module.id)).toEqual(['member', 'score', 'counter']);
  });

  test('ids, namespaces and requires are checked', () => {
    const sameId = definePluginManifest({ id: 'score', title: 'Score plugin' });
    expect(() =>
      defineManifest({
        id: 'x',
        title: 'X',
        modules: [],
        features: [scoreManifest],
        plugins: [sameId],
      }),
    ).toThrow('Feature and plugin "score" share an id');
    expect(() =>
      defineManifest({
        id: 'x',
        title: 'X',
        modules: [],
        features: [scoreManifest, scoreManifest],
      }),
    ).toThrow('Feature "score" is mounted twice');
    const intruder = defineModule({
      id: 'own',
      capabilities: [defineCapability({ ...scoreAdd, id: 'score.reset' })],
    });
    expect(() =>
      defineManifest({ id: 'x', title: 'X', modules: [intruder], features: [scoreManifest] }),
    ).toThrow('Application operation score.reset is in the namespace of "score"');
    const linked = definePluginManifest({
      id: 'linked',
      title: 'Linked',
      namespace: 'score',
      modules: [
        defineModule({
          id: 'linked',
          capabilities: [defineCapability({ ...scoreAdd, id: 'score.link' })],
        }),
      ],
    });
    expect(() =>
      defineManifest({
        id: 'x',
        title: 'X',
        modules: [],
        features: [scoreManifest],
        plugins: [linked],
      }),
    ).toThrow('share the operation namespace "score"');
    const dependent = defineFeatureManifest({ id: 'report', title: 'Report', requires: ['score'] });
    expect(() =>
      defineManifest({ id: 'x', title: 'X', modules: [], features: [dependent, scoreManifest] }),
    ).toThrow('Feature "report" requires "score" mounted before it');
    expect(() =>
      definePluginManifest({
        id: 'loose',
        title: 'Loose',
        modules: [defineModule({ id: 'loose', capabilities: [scoreAdd] })],
      }),
    ).toThrow('outside its namespace "loose."');
  });

  test('a feature is refused with resource types or sources it does not own', () => {
    expect(() =>
      defineFeature({
        manifest: scoreManifest,
        handlers: [],
        authorization: { resourceTypes: ['counter'], port: scoreFeature.authorization!.port },
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
      score: { total: 0 },
    });
    await expect(
      runtime.invokeRaw({ operation: 'score.add', input: { by: 1 } }, stranger),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await runtime.invokeRaw({ operation: 'member.add', input: { id: 'stranger' } }, owner);
    await runtime.invokeRaw({ operation: 'score.add', input: { by: 3 } }, stranger);
    expect(await storage.read(LOCAL_WORKSPACE, async (s) => s.state)).toEqual({
      members: ['owner', 'stranger'],
      log: ['score 3'],
      score: { total: 3 },
    });
    const events = await runtime.events(0, { workspaceId: LOCAL_WORKSPACE, principalId: 'nobody' });
    expect(events.events.map((event) => event.resource)).toEqual(['member:stranger']);
  });

  test('composition refuses mismatched lists, shadowed rules and service collisions', () => {
    expect(() => application({ features: [] })).toThrow(
      "Application features [] do not match its manifest's [score]",
    );
    expect(() =>
      application({
        authorization: definePolicy<Root>({
          operations: { [memberAdd.id]: 'open', [scoreAdd.id]: 'open' },
          events: {},
        }),
      }),
    ).toThrow('The application policy has a rule for score.add');
    expect(() =>
      application({
        authorization: definePolicy<Root>({
          operations: { [memberAdd.id]: 'open' },
          events: { score: () => true },
        }),
      }),
    ).toThrow('Resource type "score" has an application event rule');
    expect(() => application({ services: { score: {} } as never })).toThrow(
      'Application services already have a "score" key',
    );
    expect(() =>
      application({
        createState: () => ({ members: [], log: [], score: { total: 9 } }),
      }).createState('o'),
    ).toThrow('Application state already has a "score" key');
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
      ...scoreFeature,
      connect: () => ({ sources: { score: source } }),
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
    expect(connections.sources).toEqual({ score: source });
    const runtime = createApplicationRuntime(definition, {
      storage: createMemoryStorage<Root>(definition.createState('owner')) as never,
    });
    runtime.bindSources(connections.sources!);
    expect(() => runtime.bindSources({ score: source })).toThrow(
      'Source for "score" is bound twice',
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
    manifest: defineManifest({ id: 'score-app', title: 'Score', modules: [memberModule] }),
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
        application({ migrations: v2 }, scoreMount(adopt)),
        {
          workspacePath,
        },
      );
      await instance.application.invokeRaw({ operation: 'score.add', input: { by: 1 } }, owner);
      await instance.close();
      const snapshot = await stored(workspacePath);
      expect(snapshot.state.score).toEqual({ total: 1 });
      expect(snapshot.stateVersions).toEqual({
        application: { version: 2, readableFrom: 2 },
        'feature:score': { version: 1, readableFrom: 1 },
      });
    });
  });

  test('legacy data is adopted into the slice once, and old code refuses the result', async () => {
    await withDirectory(async (workspacePath) => {
      // Version 1 kept the score in the application's own `legacy` field.
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

      const upgraded = application({ migrations: v2 }, scoreMount(adopt));
      for (const by of [1, 1]) {
        const instance = await openEmbeddedInstance(upgraded, { workspacePath });
        await instance.application.invokeRaw({ operation: 'score.add', input: { by } }, owner);
        await instance.close();
      }
      const snapshot = await stored(workspacePath);
      expect(snapshot.state).toEqual({
        members: ['owner', 'ann'],
        log: ['score 6', 'score 7'],
        score: { total: 7 },
      });
      expect(snapshot.stateVersions?.['feature:score']).toEqual({ version: 1, readableFrom: 1 });
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
    expect(() => application({}, scoreMount(adopt))).toThrow(
      'no incompatible application migration step reaches',
    );
    expect(() =>
      application(
        { migrations: { version: 2, steps: [{ ...v2.steps[0]!, compatible: true }] } },
        scoreMount(adopt),
      ),
    ).toThrow('no incompatible application migration step reaches');
  });
});

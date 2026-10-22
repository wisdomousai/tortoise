import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  defineCapability,
  defineFeatureManifest,
  defineModule,
  jsonSchema,
} from '@agent-native/contracts';
import {
  createApplication,
  createMemoryStorage,
  definePolicy,
  featureHandlers,
  routeAuthorization,
  type AuthorizationPort,
  type FeatureHandler,
  type FeaturePolicy,
  type FeatureServer,
} from '../src/index';

const fixture = { ui: { exception: 'test fixture' } } as const;
const tally = defineCapability({
  id: 'tally.add',
  kind: 'command',
  input: jsonSchema(z.strictObject({ by: z.number(), fail: z.boolean().optional() })),
  output: jsonSchema(z.strictObject({ total: z.number(), allowed: z.boolean() })),
  permission: { action: 'add', resourceType: 'tally' },
  ...fixture,
});
const note = defineCapability({
  id: 'note.write',
  kind: 'command',
  input: jsonSchema(z.strictObject({ text: z.string() })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'note' },
  ...fixture,
});
const tallyManifest = defineFeatureManifest({
  id: 'tally',
  title: 'Tally',
  modules: [defineModule({ id: 'tally', capabilities: [tally] })],
});
const notes = defineModule({ id: 'notes', capabilities: [note] });

type Slice = { total: number };
type Access = { allows(principalId: string): boolean };
type Hooks = { onAdded?(total: number): void };
type Root = { members: string[]; log: string[]; tally: Slice };

const add: FeatureHandler<Slice, unknown, Access, Hooks, typeof tally> = {
  capability: tally,
  handle(input, ctx) {
    ctx.state.total += input.by;
    ctx.change('tally:main');
    ctx.hooks.onAdded?.(ctx.state.total);
    if (input.fail) throw new Error('after the hook');
    return { total: ctx.state.total, allowed: ctx.access.allows(ctx.context.principalId) };
  },
};
const tallyPolicy: FeaturePolicy<Slice, Access> = {
  authorize: ({ access, previousAccess, context }) => ({
    allowed:
      access.allows(context.principalId) &&
      (previousAccess === undefined || previousAccess.allows(context.principalId)),
    reason: 'NOT_A_MEMBER',
  }),
  canReadEvent: ({ access, context }) => access.allows(context.principalId),
};
const tallyFeature: FeatureServer<Slice, Access, Hooks> = {
  manifest: tallyManifest,
  handlers: [add],
  authorization: { resourceTypes: ['tally'], port: tallyPolicy },
};
const access = (state: Root): Access => ({ allows: (id) => state.members.includes(id) });
const applicationPolicy = definePolicy<Root>({
  operations: { [note.id]: 'open' },
  events: { note: () => true },
});

function setup(members = ['ann']) {
  let accessReads = 0;
  const storage = createMemoryStorage<Root>({ members, log: [], tally: { total: 0 } });
  const app = createApplication({
    modules: [notes, ...tallyManifest.modules],
    storage,
    services: {},
    authorization: routeAuthorization<Root>(applicationPolicy, [
      {
        id: 'tally',
        operations: [tally.id],
        resourceTypes: ['tally'],
        select: (state) => state.tally,
        access,
        port: tallyPolicy,
      },
    ]),
    handlers: [
      { capability: note, handle: (_input, ctx) => (ctx.change('note:1'), {}) },
      ...featureHandlers<Root, {}>(
        {
          key: 'tally',
          feature: tallyFeature,
          access: (state) => (accessReads++, access(state)),
          hooks: {
            onAdded: ((total: number, ctx: { state: Root }) => {
              ctx.state.log.push(`added to ${total}`);
            }) as never,
          },
        },
        { modules: [], applicationModules: [] },
      ),
    ],
  });
  const state = () => storage.read('w', async (snapshot) => snapshot.state);
  return { app, state, reads: () => accessReads };
}
const ann = { workspaceId: 'w', principalId: 'ann' };
const bob = { workspaceId: 'w', principalId: 'bob' };

describe('feature composition', () => {
  test('a handler sees its slice, a lazy access view and hooks bound to the transaction', async () => {
    const { app, state, reads } = setup();
    const receipt = await app.invoke({ operation: 'tally.add', input: { by: 2 } }, ann);
    expect(receipt.result).toEqual({ total: 2, allowed: true });
    expect(reads()).toBe(1);
    expect(await state()).toMatchObject({ log: ['added to 2'], tally: { total: 2 } });
  });

  test('a failing handler rolls back the hook write with the slice', async () => {
    const { app, state } = setup();
    await expect(
      app.invoke({ operation: 'tally.add', input: { by: 2, fail: true } }, ann),
    ).rejects.toThrow();
    expect(await state()).toMatchObject({ log: [], tally: { total: 0 } });
  });

  test('the feature policy decides its operations and events over the access view', async () => {
    const { app } = setup();
    await expect(
      app.invoke({ operation: 'tally.add', input: { by: 1 } }, bob),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await app.invoke({ operation: 'tally.add', input: { by: 1 } }, ann);
    await app.invoke({ operation: 'note.write', input: { text: 'x' } }, bob);
    const seen = async (context: typeof ann) =>
      (await app.events(0, context)).events.map((event) => event.resource);
    expect(await seen(ann)).toEqual(['tally:main', 'note:1']);
    expect(await seen(bob)).toEqual(['note:1']);
  });

  test('a unit cannot claim what the application policy covers', () => {
    const unit = {
      id: 'tally',
      operations: [tally.id],
      resourceTypes: ['tally'],
      select: (state: Root) => state.tally,
      port: tallyPolicy,
    };
    expect(
      definePolicy<Root>({ operations: { a: 'open' }, events: { x: () => true } }).covers,
    ).toEqual({ operations: ['a'], resourceTypes: ['x'] });
    expect(() =>
      routeAuthorization<Root>(
        definePolicy<Root>({ operations: {}, events: { tally: () => true } }),
        [unit],
      ),
    ).toThrow('Resource type "tally" has an application event rule');
    expect(() =>
      routeAuthorization<Root>(
        definePolicy<Root>({ operations: { [tally.id]: 'open' }, events: {} }),
        [unit],
      ),
    ).toThrow('The application policy has a rule for tally.add');
    expect(routeAuthorization<Root>(applicationPolicy, [unit]).covers).toEqual({
      operations: [note.id, tally.id],
      resourceTypes: ['note', 'tally'],
    });
  });

  test('resource reads route to the owning policy and keep the application rule', async () => {
    const application: AuthorizationPort<Root> = {
      authorize: () => ({ allowed: true }),
      canReadEvent: () => false,
      canReadResource: ({ resource }) => resource === 'note:open',
    };
    const port = routeAuthorization<Root>(application, [
      {
        id: 'tally',
        operations: [],
        resourceTypes: ['tally'],
        select: (state) => state.tally,
        access,
        port: tallyPolicy,
      },
    ]);
    const state: Root = { members: ['ann'], log: [], tally: { total: 0 } };
    const read = (resource: string, context = ann) =>
      port.canReadResource!({ resource, event: { resource } as never, context, state });
    expect(await read('note:open')).toBe(true);
    expect(await read('note:closed')).toBe(false);
    expect(await read('tally:main')).toBe(true);
    expect(await read('tally:main', bob)).toBe(false);
  });
});

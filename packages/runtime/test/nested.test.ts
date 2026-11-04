import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  ApplicationError,
  defineCapability,
  defineModule,
  jsonSchema,
  jsonValueSchema,
  type AuditRecord,
} from '@tortoise/contracts';
import { createMemoryEventLog, unresolvedCommands } from '@tortoise/event-log';
import {
  authorizationRoute,
  composeAuthorization,
  createApplication,
  createHandlerFactory,
  createMemoryStorage,
  sliceHandlers,
  type AuthorizationPort,
  type AuthorizationRequest,
  type ExecutionContext,
  type HandlerContext,
} from '../src/index';

const fixture = { ui: { exception: 'test fixture' } } as const;
const set = defineCapability({
  id: 'item.set',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string(), value: z.number() })),
  output: jsonSchema(
    z.strictObject({ id: z.string(), value: z.number(), secret: z.string().optional() }),
  ),
  permission: { action: 'update', resourceType: 'item' },
  ...fixture,
});
const get = defineCapability({
  id: 'item.get',
  kind: 'query',
  input: jsonSchema(z.strictObject({ id: z.string() })),
  output: jsonSchema(z.strictObject({ value: z.number().nullable() })),
  permission: { action: 'read', resourceType: 'item' },
  ...fixture,
});
const attach = defineCapability({
  id: 'item.attach',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string() })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'update', resourceType: 'item' },
  ...fixture,
});
const compose = defineCapability({
  id: 'item.compose',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string().optional() })),
  output: jsonSchema(jsonValueSchema),
  permission: { action: 'update', resourceType: 'item' },
  invokes: ['item.set', 'item.get', 'item.attach', 'item.relay'],
  ...fixture,
});
const relay = defineCapability({
  id: 'item.relay',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string() })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'update', resourceType: 'item' },
  invokes: ['item.set'],
  ...fixture,
});
const loop = defineCapability({
  id: 'item.loop',
  kind: 'command',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'update', resourceType: 'item' },
  invokes: 'any',
  ...fixture,
});
const chain = [1, 2, 3, 4, 5, 6].map((step) =>
  defineCapability({
    id: `chain.${step}`,
    kind: 'command',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.number()),
    permission: { action: 'update', resourceType: 'item' },
    invokes: 'any',
    ...fixture,
  }),
);
const items = defineModule({
  id: 'items',
  capabilities: [set, get, attach, compose, relay, loop, ...chain],
});

type State = { items: Record<string, number> };
type Compose = (input: { id?: string }, ctx: HandlerContext<State, {}>) => unknown;
const owner: ExecutionContext = { workspaceId: 'w', principalId: 'owner' };

function setup(options: { log?: ReturnType<typeof createMemoryEventLog> } = {}) {
  const storage = createMemoryStorage<State>({ items: {} });
  const seen: AuthorizationRequest<State>[] = [];
  const control: {
    compose: Compose;
    deny?: (request: AuthorizationRequest<State>) => boolean;
  } = { compose: () => ({}) };
  const policy: AuthorizationPort<State> = {
    authorize(request) {
      seen.push(request);
      return control.deny?.(request) ? { allowed: false, reason: 'DENIED' } : { allowed: true };
    },
    canReadEvent: () => true,
    // The secret is never shown to the caller, nested or not.
    projectOutput: ({ capability, output }) => {
      if (capability.id !== 'item.set') return output;
      const { secret: _secret, ...visible } = output as { secret?: string };
      return visible;
    },
  };
  const bind = createHandlerFactory<State, {}>();
  let runs = 0;
  const app = createApplication({
    modules: [items],
    storage,
    authorization: policy,
    services: {},
    ...(options.log ? { eventLog: options.log } : {}),
    handlers: [
      bind(set, (input, ctx) => {
        ctx.state.items[input.id] = input.value;
        ctx.change(`item:${input.id}`, 'item.set');
        return { ...input, secret: 'hidden' };
      }),
      bind(get, async (input, ctx) => {
        if (input.id === 'write') await ctx.invoke(set, { id: 'x', value: 1 });
        return { value: ctx.state.items[input.id] ?? null };
      }),
      bind(attach, (input, ctx) => {
        ctx.change(`item:${input.id}`);
        ctx.attach(`item:${input.id}`, {
          digest: 'a'.repeat(64),
          size: 1,
          mediaType: 'text/plain',
        });
        return {};
      }),
      bind(compose, (input, ctx) => {
        runs++;
        return control.compose(input, ctx) as never;
      }),
      bind(relay, (input, ctx) => {
        ctx.continueWith('item.set', { id: input.id, value: 7 });
        return {};
      }),
      bind(loop, async (_input, ctx) => {
        await ctx.invokeRaw('item.loop', {});
        return {};
      }),
      ...chain.map((capability, index) =>
        bind(capability, async (_input, ctx) => {
          const next = chain[index + 1];
          return next ? ((await ctx.invokeRaw(next.id, {})).result as number) + 1 : 0;
        }),
      ),
    ],
  });
  const invoke = (input: { id?: string } = {}, context = owner, idempotencyKey?: string) =>
    app.invoke(
      { operation: 'item.compose', input, ...(idempotencyKey ? { idempotencyKey } : {}) },
      context,
    );
  const refused = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApplicationError);
    return error as ApplicationError;
  };
  const snapshot = () => storage.read('w', async (current) => structuredClone(current));
  return { app, control, seen, invoke, refused, snapshot, runs: () => runs };
}

describe('nested call', () => {
  test('a nested command returns its projected, typed output inside one transaction', async () => {
    const { control, invoke, snapshot } = setup();
    control.compose = async (_input, ctx) => {
      const a = await ctx.invoke(set, { id: 'a', value: 1 });
      const value: number = a.value;
      const b = await ctx.invokeRaw('item.set', { id: 'b', value: value + 1 });
      return { a, b: b.result, effects: b.effects };
    };
    const receipt = await invoke();
    expect(receipt.result).toEqual({
      a: { id: 'a', value: 1 },
      b: { id: 'b', value: 2 },
      effects: [],
    });
    expect(receipt.revisions).toEqual({ 'item:a': 1, 'item:b': 1 });
    const stored = await snapshot();
    expect(stored.state.items).toEqual({ a: 1, b: 2 });
    expect(stored.cursor).toBe(2);
  });

  test('one journal entry per resource, from the innermost frame that declared it', async () => {
    const { control, invoke, snapshot } = setup();
    control.compose = async (_input, ctx) => {
      ctx.change('item:a');
      await ctx.invoke(set, { id: 'a', value: 1 });
      ctx.change('item:a', 'compose.after');
      ctx.state.items.own = 1;
      ctx.change('item:own');
      return {};
    };
    const receipt = await invoke();
    expect(receipt.revisions).toEqual({ 'item:a': 1, 'item:own': 1 });
    const { journal } = await snapshot();
    expect(journal.map(({ resource, type, operation }) => ({ resource, type, operation }))).toEqual(
      [
        { resource: 'item:a', type: 'item.set', operation: 'item.set' },
        { resource: 'item:own', type: 'changed', operation: 'item.compose' },
      ],
    );
  });

  test('policy sees the enclosing operations as via at invoke and commit', async () => {
    const { control, invoke, seen } = setup();
    control.compose = async (_input, ctx) => {
      await ctx.invoke(set, { id: 'a', value: 1 });
      await ctx.query(get, { id: 'a' });
      return {};
    };
    await invoke();
    expect(
      seen.map((request) => [request.capability.id, request.phase, request.via ?? null]),
    ).toEqual([
      ['item.compose', 'invoke', null],
      ['item.set', 'invoke', ['item.compose']],
      ['item.set', 'commit', ['item.compose']],
      ['item.get', 'invoke', ['item.compose']],
      ['item.get', 'invoke', ['item.compose']],
      ['item.compose', 'commit', null],
    ]);
  });

  test('a refused child rolls the whole transaction back, even when the handler catches it', async () => {
    const { control, invoke, refused, snapshot } = setup();
    control.deny = (request) =>
      request.capability.id === 'item.set' && (request.input as { id: string }).id === 'b';
    control.compose = async (_input, ctx) => {
      await ctx.invoke(set, { id: 'a', value: 1 });
      try {
        await ctx.invoke(set, { id: 'b', value: 2 });
      } catch {
        // swallowed: the transaction still fails
      }
      return {};
    };
    expect((await refused(invoke())).code).toBe('FORBIDDEN');
    const stored = await snapshot();
    expect(stored.state.items).toEqual({});
    expect(stored.journal).toEqual([]);
  });

  test('the commit phase rechecks each child over the state it proposed', async () => {
    const { control, invoke, refused } = setup();
    control.deny = (request) =>
      request.capability.id === 'item.set' &&
      request.phase === 'commit' &&
      (request.state.items.a ?? 0) > 10;
    control.compose = async (_input, ctx) => ctx.invoke(set, { id: 'a', value: 11 });
    expect((await refused(invoke())).code).toBe('FORBIDDEN');
  });

  test('the grant must name the child operation and cover its resources', async () => {
    const { control, invoke, refused } = setup();
    control.compose = async (input, ctx) => ctx.invoke(set, { id: input.id ?? 'a', value: 1 });
    const narrow = { ...owner, grant: { operations: ['item.compose'] } };
    expect((await refused(invoke({}, narrow))).code).toBe('FORBIDDEN');
    const scoped = {
      ...owner,
      grant: { operations: ['item.compose', 'item.set'], resources: ['item:a'] },
    };
    expect((await invoke({ id: 'a' }, scoped)).revisions).toEqual({ 'item:a': 1 });
    expect((await refused(invoke({ id: 'b' }, scoped))).code).toBe('FORBIDDEN');
  });

  test('expected revisions are the child preconditions', async () => {
    const { control, invoke, refused } = setup();
    control.compose = async (_input, ctx) =>
      ctx.invoke(set, { id: 'a', value: 1 }, { 'item:a': 3 });
    expect((await refused(invoke())).code).toBe('CONFLICT');
  });

  test('a child attaches blobs only under its own limits', async () => {
    const { control, invoke, refused } = setup();
    control.compose = async (_input, ctx) => ctx.invoke(attach, { id: 'a' });
    const error = await refused(invoke());
    expect([error.code, error.message]).toEqual(['INTERNAL', 'Operation declares no blob limits']);
  });

  test('a nested query reads the writes made so far and cannot write', async () => {
    const { control, invoke, refused } = setup();
    control.compose = async (input, ctx) => {
      await ctx.invoke(set, { id: 'a', value: 3 });
      return ctx.query(get, { id: input.id ?? 'a' });
    };
    expect((await invoke()).result).toEqual({ value: 3 });
    const error = await refused(invoke({ id: 'write' }));
    expect([error.code, error.message]).toEqual(['INTERNAL', 'Queries cannot invoke commands']);
  });

  test('calls outside the declaration, the limits or the frame are refused', async () => {
    const { app, control, invoke, refused } = setup();
    const message = async (run: Compose) => {
      control.compose = run;
      const error = await refused(invoke());
      expect(error.code).toBe('INTERNAL');
      return error.message;
    };
    expect(await message((_input, ctx) => ctx.invokeRaw('item.loop', {}))).toBe(
      'item.compose does not declare item.loop',
    );
    expect(
      await message(async (_input, ctx) => {
        for (let call = 0; call < 65; call++) await ctx.invoke(set, { id: 'a', value: call });
      }),
    ).toBe('A command makes at most 64 nested calls');
    expect(
      await message((_input, ctx) =>
        Promise.all([
          ctx.invoke(set, { id: 'a', value: 1 }),
          ctx.invoke(set, { id: 'b', value: 1 }),
        ]),
      ),
    ).toBe('Nested calls run one at a time');
    expect(
      await message((_input, ctx) => {
        void ctx.invoke(set, { id: 'a', value: 1 }).catch(() => undefined);
        return {};
      }),
    ).toBe('A nested call must finish before its handler returns');
    const recursion = await refused(app.invoke({ operation: 'item.loop', input: {} }, owner));
    expect(recursion.message).toBe('A nested call cannot reach a running operation');
    const deep = await refused(app.invokeRaw({ operation: 'chain.1', input: {} }, owner));
    expect(deep.message).toBe('Nested calls go at most 4 levels deep');
    expect((await app.invokeRaw({ operation: 'chain.2', input: {} }, owner)).result).toBe(4);
  });

  test('a retry replays the receipt only while every nested command is still allowed', async () => {
    const { control, invoke, refused, runs } = setup();
    control.compose = async (_input, ctx) => ctx.invoke(set, { id: 'a', value: 1 });
    const first = await invoke({}, owner, 'k1');
    expect((await invoke({}, owner, 'k1')).result).toEqual(first.result);
    expect(runs()).toBe(1);
    const replays: unknown[] = [];
    control.deny = (request) => {
      if (request.phase === 'replay') replays.push([request.capability.id, request.via ?? null]);
      return request.phase === 'replay' && request.capability.id === 'item.set';
    };
    expect((await refused(invoke({}, owner, 'k1'))).code).toBe('FORBIDDEN');
    expect(replays).toEqual([
      ['item.compose', null],
      ['item.set', ['item.compose']],
    ]);
    expect(runs()).toBe(1);
  });

  test('each frame is audited under one correlation ID and recovered together', async () => {
    const log = createMemoryEventLog();
    const { app, control, invoke } = setup({ log });
    control.compose = async (_input, ctx) => {
      ctx.change('item:a');
      await ctx.invoke(set, { id: 'a', value: 1 });
      return {};
    };
    await invoke();
    const accepted = log.events().filter((event) => event.kind === 'command.accepted');
    expect(
      accepted.map((event) => [
        event.operation,
        event.resources,
        event.data?.depth ?? 0,
        event.data?.parent ?? null,
      ]),
    ).toEqual([
      ['item.compose', [], 0, null],
      ['item.set', ['item:a'], 1, 'item.compose'],
    ]);
    expect(new Set(accepted.map((event) => event.correlationId)).size).toBe(1);
    expect(new Set(accepted.map((event) => event.data?.fromCursor))).toEqual(new Set([0]));
    // As if the process stopped before `command.committed`: the parent journaled nothing under
    // its own operation, and is recovered with the frame that did.
    const records: readonly AuditRecord[] = await app.recoverAudit(unresolvedCommands(accepted));
    expect(records.map((record) => [record.operation, record.kind])).toEqual([
      ['item.compose', 'command.recovered'],
      ['item.set', 'command.recovered'],
    ]);
  });
});

describe('continuation as a tail frame', () => {
  test('the continued command runs after the frame and shares its journal entry', async () => {
    const { control, invoke, seen, snapshot } = setup();
    control.compose = (_input, ctx) => {
      ctx.change('item:a');
      ctx.continueWith('item.set', { id: 'a', value: 2 });
      return {};
    };
    const receipt = await invoke();
    expect(receipt.continuation).toEqual({ operation: 'item.set', result: { id: 'a', value: 2 } });
    expect(receipt.revisions).toEqual({ 'item:a': 1 });
    const { journal } = await snapshot();
    expect(journal.map(({ operation }) => operation)).toEqual(['item.set']);
    expect(seen.map((request) => [request.capability.id, request.phase])).toEqual([
      ['item.compose', 'invoke'],
      ['item.compose', 'commit'],
      ['item.set', 'invoke'],
      ['item.set', 'commit'],
    ]);
    expect(seen.at(-1)?.via).toEqual(['item.compose']);
  });

  test('a continued command may continue once more within the limits', async () => {
    const { control, invoke, snapshot, refused } = setup();
    control.compose = async (input, ctx) => {
      if (input.id === 'nested') await ctx.invoke(relay, { id: 'b' });
      else ctx.continueWith('item.relay', { id: 'a' });
      return {};
    };
    expect((await invoke()).continuation?.operation).toBe('item.relay');
    expect((await snapshot()).state.items).toEqual({ a: 7 });
    // A nested command's continuation commits with it.
    expect((await invoke({ id: 'nested' })).revisions).toEqual({ 'item:b': 1 });
    control.compose = (_input, ctx) => (ctx.continueWith('item.loop', {}), {});
    expect((await refused(invoke())).message).toBe('item.compose does not declare item.loop');
  });

  test('replay authorizes the continued command again', async () => {
    const { control, invoke, refused } = setup();
    control.compose = (_input, ctx) => (ctx.continueWith('item.set', { id: 'a', value: 1 }), {});
    await invoke({}, owner, 'k1');
    control.deny = (request) => request.phase === 'replay' && request.capability.id === 'item.set';
    expect((await refused(invoke({}, owner, 'k1'))).code).toBe('FORBIDDEN');
  });
});

describe('nested call across slices', () => {
  const note = defineCapability({
    id: 'note.add',
    kind: 'command',
    input: jsonSchema(z.strictObject({ id: z.string() })),
    output: jsonSchema(z.strictObject({ keys: z.array(z.string()), counter: z.number() })),
    permission: { action: 'create', resourceType: 'note' },
    invokes: ['counter.bump'],
    ...fixture,
  });
  const bump = defineCapability({
    id: 'counter.bump',
    kind: 'command',
    input: jsonSchema(z.strictObject({ id: z.string() })),
    output: jsonSchema(z.strictObject({ value: z.number(), keys: z.array(z.string()) })),
    permission: { action: 'update', resourceType: 'counter' },
    ...fixture,
  });
  const notes = defineModule({ id: 'notes', capabilities: [note] });
  const counters = defineModule({ id: 'counters', capabilities: [bump] });
  type Notes = { notes: Record<string, true> };
  type Counters = { counters: Record<string, number>; frozen: boolean };
  type Root = { notes: Notes; counters: Counters };

  function crossing(frozen: boolean) {
    const seen: string[][] = [];
    const allow = <S extends object>(
      module: string,
      open: (state: S) => boolean,
    ): AuthorizationPort<S> => ({
      authorize: ({ state }) => {
        seen.push([module, ...Object.keys(state)]);
        return { allowed: open(state), reason: 'FROZEN' };
      },
      canReadEvent: () => true,
    });
    const noteHandlers = createHandlerFactory<Notes, {}>();
    const counterHandlers = createHandlerFactory<Counters, {}>();
    const app = createApplication({
      modules: [notes, counters],
      storage: createMemoryStorage<Root>({
        notes: { notes: {} },
        counters: { counters: {}, frozen },
      }),
      services: {},
      authorization: composeAuthorization<Root>([
        authorizationRoute(
          'notes',
          notes,
          ['note'],
          allow<Notes>('notes', () => true),
        ),
        authorizationRoute(
          'counters',
          counters,
          ['counter'],
          allow<Counters>('counters', (state) => !state.frozen),
        ),
      ]),
      handlers: [
        ...sliceHandlers<Root, 'notes', {}>('notes', [
          noteHandlers(note, async (input, ctx) => {
            ctx.state.notes[input.id] = true;
            ctx.change(`note:${input.id}`);
            const { value } = await ctx.invoke(bump, { id: input.id });
            return { keys: Object.keys(ctx.state), counter: value };
          }),
        ]),
        ...sliceHandlers<Root, 'counters', {}>('counters', [
          counterHandlers(bump, (input, ctx) => {
            const value = (ctx.state.counters[input.id] ?? 0) + 1;
            ctx.state.counters[input.id] = value;
            ctx.change(`counter:${input.id}`);
            return { value, keys: Object.keys(ctx.state) };
          }),
        ]),
      ],
    });
    return { app, seen };
  }

  test('a child runs on its own slice under its own policy', async () => {
    const { app, seen } = crossing(false);
    const receipt = await app.invoke({ operation: 'note.add', input: { id: 'n1' } }, owner);
    expect(receipt.result).toEqual({ keys: ['notes'], counter: 1 });
    expect(receipt.revisions).toEqual({ 'counter:n1': 1, 'note:n1': 1 });
    expect(seen).toContainEqual(['counters', 'counters', 'frozen']);
    expect(
      seen.every(([module, first]) =>
        module === 'notes' ? first === 'notes' : first === 'counters',
      ),
    ).toBe(true);
    const frozen = crossing(true);
    const error = await frozen.app
      .invoke({ operation: 'note.add', input: { id: 'n1' } }, owner)
      .catch((caught: unknown) => caught);
    expect((error as ApplicationError).code).toBe('FORBIDDEN');
  });
});

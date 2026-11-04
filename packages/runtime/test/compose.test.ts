import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';
import {
  authorizationRoute,
  composeAuthorization,
  createApplication,
  createHandlerFactory,
  createMemoryStorage,
  sliceHandlers,
  type AuthorizationPort,
} from '../src/index';

const fixture = { ui: { exception: 'test fixture' } } as const;
const addNote = defineCapability({
  id: 'note.add',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string(), text: z.string() })),
  output: jsonSchema(z.strictObject({ keys: z.array(z.string()) })),
  permission: { action: 'create', resourceType: 'note' },
  ...fixture,
});
const bump = defineCapability({
  id: 'counter.bump',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string() })),
  output: jsonSchema(z.strictObject({ value: z.number() })),
  permission: { action: 'update', resourceType: 'counter' },
  ...fixture,
});
const orphan = defineCapability({
  id: 'orphan.touch',
  kind: 'command',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'update', resourceType: 'orphan' },
  ...fixture,
});
const notes = defineModule({ id: 'notes', capabilities: [addNote] });
const counters = defineModule({ id: 'counters', capabilities: [bump] });
const orphans = defineModule({ id: 'orphans', capabilities: [orphan] });

type Notes = { owner: string; notes: Record<string, string> };
type Counters = { counters: Record<string, number>; frozen: boolean };
type Root = { notes: Notes; counters: Counters };
const writer = { workspaceId: 'w', principalId: 'writer' };
const stranger = { workspaceId: 'w', principalId: 'stranger' };

function setup() {
  const seen: { module: string; keys: string[]; previous?: string[] }[] = [];
  const notesPolicy: AuthorizationPort<Notes> = {
    authorize({ state, previousState, context }) {
      seen.push({
        module: 'notes',
        keys: Object.keys(state),
        ...(previousState ? { previous: Object.keys(previousState) } : {}),
      });
      return { allowed: context.principalId === state.owner, reason: 'NOT_OWNER' };
    },
    canReadEvent: ({ state, context }) => context.principalId === state.owner,
  };
  const countersPolicy: AuthorizationPort<Counters> = {
    authorize({ state }) {
      seen.push({ module: 'counters', keys: Object.keys(state) });
      return { allowed: !state.frozen, reason: 'FROZEN' };
    },
    canReadEvent: () => true,
  };
  const noteHandlers = createHandlerFactory<Notes, {}>();
  const counterHandlers = createHandlerFactory<Counters, {}>();
  const app = createApplication({
    modules: [notes, counters, orphans],
    storage: createMemoryStorage<Root>({
      notes: { owner: 'writer', notes: {} },
      counters: { counters: {}, frozen: false },
    }),
    services: {},
    authorization: composeAuthorization<Root>([
      authorizationRoute('notes', notes, ['note'], notesPolicy),
      authorizationRoute('counters', counters, ['counter'], countersPolicy),
    ]),
    handlers: [
      ...sliceHandlers<Root, 'notes', {}>('notes', [
        noteHandlers(addNote, (input, ctx) => {
          ctx.state.notes[input.id] = input.text;
          ctx.change(`note:${input.id}`);
          return { keys: Object.keys(ctx.state) };
        }),
      ]),
      ...sliceHandlers<Root, 'counters', {}>('counters', [
        counterHandlers(bump, (input, ctx) => {
          const value = (ctx.state.counters[input.id] ?? 0) + 1;
          ctx.state.counters[input.id] = value;
          ctx.change(`counter:${input.id}`);
          return { value };
        }),
      ]),
      { capability: orphan, handle: (_input, ctx) => (ctx.change('orphan:1'), {}) },
    ],
  });
  return { app, seen };
}

describe('module composition', () => {
  test('handlers and policies see only their own slice of the composed state', async () => {
    const { app, seen } = setup();
    const note = await app.invoke(
      { operation: 'note.add', input: { id: 'n1', text: 'hello' }, idempotencyKey: 'n1' },
      writer,
    );
    expect(note.result.keys).toEqual(['owner', 'notes']);
    const counter = await app.invoke(
      { operation: 'counter.bump', input: { id: 'c1' }, idempotencyKey: 'c1' },
      stranger,
    );
    expect(counter.result.value).toBe(1);
    expect(
      seen.filter((entry) => entry.module === 'notes').every((e) => e.keys[0] === 'owner'),
    ).toBe(true);
    // Commit-time checks pass the module's slice of both the proposed and the previous state.
    expect(seen).toContainEqual({
      module: 'notes',
      keys: ['owner', 'notes'],
      previous: ['owner', 'notes'],
    });
    expect(seen.filter((entry) => entry.module === 'counters').map((e) => e.keys)).toContainEqual([
      'counters',
      'frozen',
    ]);
  });

  test('each operation is decided by its own module policy', async () => {
    const { app } = setup();
    await expect(
      app.invoke(
        { operation: 'note.add', input: { id: 'n1', text: 'x' }, idempotencyKey: 'denied' },
        stranger,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('an operation or resource type without a route fails closed', async () => {
    const { app } = setup();
    await expect(
      app.invoke({ operation: 'orphan.touch', input: {}, idempotencyKey: 'orphan' }, writer),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const authorization = composeAuthorization<Root>([
      authorizationRoute('counters', counters, ['counter'], {
        authorize: () => ({ allowed: true }),
        canReadEvent: () => true,
      }),
    ]);
    const event = (resource: string) =>
      authorization.canReadEvent({
        state: { notes: { owner: 'writer', notes: {} }, counters: { counters: {}, frozen: false } },
        context: writer,
        event: { resource } as never,
      });
    expect(event('counter:1')).toBe(true);
    expect(event('note:1')).toBe(false);
    expect(event('unprefixed')).toBe(false);
  });

  test('journal events are filtered by the policy owning the resource type', async () => {
    const { app } = setup();
    await app.invoke(
      { operation: 'note.add', input: { id: 'n1', text: 'private' }, idempotencyKey: 'n1' },
      writer,
    );
    await app.invoke(
      { operation: 'counter.bump', input: { id: 'c1' }, idempotencyKey: 'c1' },
      writer,
    );
    const resources = async (context: typeof writer) =>
      (await app.events(0, context)).events.map((event) => event.resource);
    expect(await resources(writer)).toEqual(['note:n1', 'counter:c1']);
    expect(await resources(stranger)).toEqual(['counter:c1']);
  });

  test('duplicate routes are rejected when the application is composed', () => {
    const allow: AuthorizationPort<unknown> = {
      authorize: () => ({ allowed: true }),
      canReadEvent: () => true,
    };
    expect(() =>
      composeAuthorization<Root>([
        authorizationRoute('notes', notes, ['note'], allow),
        authorizationRoute('counters', notes, ['counter'], allow),
      ]),
    ).toThrow('Operation has two authorization routes: note.add');
    expect(() =>
      composeAuthorization<Root>([
        authorizationRoute('notes', notes, ['shared'], allow),
        authorizationRoute('counters', counters, ['shared'], allow),
      ]),
    ).toThrow('Invalid or duplicate routed resource type: shared');
  });
});

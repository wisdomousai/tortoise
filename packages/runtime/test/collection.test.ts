import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  collectionGet,
  collectionList,
  defineCapability,
  defineCollection,
  defineModule,
  jsonSchema,
  listFilters,
  listSortFields,
} from '@tortoise/contracts';
import {
  collectionGetHandler,
  collectionListHandler,
  createApplication,
  createMemoryStorage,
  records,
} from '../src/index';

interface Note {
  id: string;
  team: string;
  status: 'open' | 'closed';
  text: string;
  secret: string;
}
interface State {
  notes: Record<string, Note>;
  teams: Record<string, string[]>;
}

const notes = defineCollection({
  type: 'note',
  resourceType: 'Note',
  item: z.strictObject({
    id: z.string(),
    team: z.string(),
    status: z.enum(['open', 'closed']),
    text: z.string(),
  }),
  container: 'team',
  label: { one: 'Note', many: 'Notes' },
});
const getNote = collectionGet(notes, { id: 'note', description: 'Read one note.' });
const listNotes = collectionList(notes, {
  id: 'note',
  filters: ['status'],
  sort: ['status', 'text'],
  description: 'List notes in your teams.',
});
const fixture = { ui: { exception: 'test fixture' } } as const;
const write = defineCapability({
  id: 'note.write',
  kind: 'command',
  input: jsonSchema(
    z.strictObject({
      id: z.string(),
      team: z.string(),
      text: z.string(),
      mode: z.enum(['insert', 'update', 'remove']),
    }),
  ),
  output: jsonSchema(z.strictObject({ resource: z.string() })),
  permission: { action: 'write', resourceType: 'Note' },
  ...fixture,
});

const sees = (state: State, principal: string, note: Note) =>
  state.teams[note.team]?.includes(principal) ?? false;

const read = {
  store: (state: State) => state.notes,
  visible: (record: Note, ctx: { state: State; context: { principalId: string } }) =>
    sees(ctx.state, ctx.context.principalId, record),
  present: ({ secret: _secret, ...visible }: Note) => visible,
};

function setup() {
  const note = (id: string, team: string, status: Note['status'] = 'open'): Note => ({
    id,
    team,
    status,
    text: id,
    secret: 'hidden',
  });
  const state: State = {
    teams: { red: ['ann'], blue: ['ann', 'bob'] },
    notes: {
      a: note('a', 'red'),
      b: note('b', 'blue'),
      c: note('c', 'blue', 'closed'),
      d: note('d', 'red', 'closed'),
    },
  };
  return createApplication({
    modules: [defineModule({ id: 'notes', capabilities: [getNote, listNotes, write] })],
    storage: createMemoryStorage<State>(state),
    services: {},
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    handlers: [
      collectionGetHandler<State, {}, typeof getNote, Note>(notes, getNote, read),
      collectionListHandler<State, {}, typeof listNotes, Note>(notes, listNotes, read),
      {
        capability: write,
        handle(input, ctx) {
          const args = input as { id: string; team: string; text: string; mode: string };
          const set = records(ctx, notes, (ctx.state as State).notes);
          const value = { id: args.id, team: args.team, status: 'open', text: args.text } as Note;
          if (args.mode === 'insert') set.insert(args.id, { ...value, secret: '' }, 'created');
          if (args.mode === 'update') set.update(args.id, { text: args.text });
          if (args.mode === 'remove') set.remove(args.id, 'removed');
          return { resource: set.resource(args.id) };
        },
      },
    ],
  });
}
const ann = { workspaceId: 'w', principalId: 'ann' };
const bob = { workspaceId: 'w', principalId: 'bob' };

describe('collections', () => {
  test('list scopes rows before filters, counts and pages', async () => {
    const app = setup();
    const page = await app.query({ operation: 'note.list', input: { limit: 1 } }, bob);
    expect(page.data).toEqual({
      items: [{ id: 'b', team: 'blue', status: 'open', text: 'b' }],
      total: 2,
    });
    const closed = await app.query({ operation: 'note.list', input: { status: 'closed' } }, ann);
    expect(closed.data.items.map((item) => item.id)).toEqual(['c', 'd']);
    expect(closed.data.total).toBe(2);
    const second = await app.query({ operation: 'note.list', input: { offset: 1 } }, bob);
    expect(second.data.items.map((item) => item.id)).toEqual(['c']);
  });

  test('a declared sort field orders the page either way; the handler order breaks ties', async () => {
    const app = setup();
    expect(listSortFields(listNotes)).toEqual(['status', 'text']);
    const byStatus = await app.query(
      { operation: 'note.list', input: { sortBy: 'status', sortDirection: 'desc' } },
      ann,
    );
    expect(byStatus.data.items.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
    const byText = await app.query(
      { operation: 'note.list', input: { sortBy: 'text', sortDirection: 'desc' } },
      ann,
    );
    expect(byText.data.items.map((item) => item.id)).toEqual(['d', 'c', 'b', 'a']);
    await expect(
      app.query({ operation: 'note.list', input: { sortBy: 'secret' } } as never, ann),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('get hides a record the caller may not see as if it were missing', async () => {
    const app = setup();
    await expect(
      app.query({ operation: 'note.get', input: { id: 'a' } }, bob),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      app.query({ operation: 'note.get', input: { id: '__proto__' } }, ann),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const found = await app.query({ operation: 'note.get', input: { id: 'a' } }, ann);
    expect(found.data).not.toHaveProperty('secret');
  });

  test('writes declare the record resource and conflict on a stale revision', async () => {
    const app = setup();
    const created = await app.invoke(
      {
        operation: 'note.write',
        input: { id: 'e', team: 'blue', text: 'new', mode: 'insert' },
        idempotencyKey: 'e1',
      },
      bob,
    );
    expect(created.revisions).toEqual({ 'note:e': 1 });
    await expect(
      app.invoke(
        {
          operation: 'note.write',
          input: { id: 'e', team: 'blue', text: 'again', mode: 'insert' },
          idempotencyKey: 'e2',
        },
        bob,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await app.invoke(
      {
        operation: 'note.write',
        input: { id: 'e', team: 'blue', text: 'edited', mode: 'update' },
        idempotencyKey: 'e3',
        expectedRevisions: { 'note:e': 1 },
      },
      bob,
    );
    await expect(
      app.invoke(
        {
          operation: 'note.write',
          input: { id: 'e', team: 'blue', text: 'late', mode: 'update' },
          idempotencyKey: 'e4',
          expectedRevisions: { 'note:e': 1 },
        },
        bob,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const events = await app.events(0, bob);
    expect(events.events.map((event) => [event.resource, event.type])).toEqual([
      ['note:e', 'created'],
      ['note:e', 'changed'],
    ]);
  });

  test('removing or updating a missing record is NOT_FOUND', async () => {
    const app = setup();
    await expect(
      app.invoke(
        {
          operation: 'note.write',
          input: { id: 'zz', team: 'blue', text: '', mode: 'remove' },
          idempotencyKey: 'r1',
        },
        bob,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('declarations reject keys, containers and filters that are not item fields', () => {
    const item = z.strictObject({ id: z.string() });
    expect(() => defineCollection({ type: 'Bad:type', resourceType: 'X', item })).toThrow();
    expect(() =>
      defineCollection({ type: 'x', resourceType: 'X', item, key: 'nope' as 'id' }),
    ).toThrow('Collection key is not an item field: nope');
    const x = defineCollection({ type: 'x', resourceType: 'X', item });
    expect(() =>
      collectionList(x, { id: 'x', filters: ['nope' as 'id'], description: 'l' }),
    ).toThrow('Collection filter is not an item field: nope');
    expect(getNote.id).toBe('note.get');
    expect(listNotes.dependencies).toEqual(['note']);
    expect(listFilters(listNotes)).toEqual(['status']);
  });
});

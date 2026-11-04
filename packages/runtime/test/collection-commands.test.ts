import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  ApplicationError,
  blobRefSchema,
  collectionCreate,
  collectionMove,
  collectionRetire,
  collectionTree,
  collectionUpdate,
  defineCollection,
  defineModule,
  recordKeySchema,
} from '@tortoise/contracts';
import {
  ancestors,
  collectionCommandHandlers,
  collectionTreeHandler,
  createApplication,
  createMemoryBlobStore,
  createMemoryStorage,
  subtree,
} from '../src/index';

interface Place {
  id: string;
  name: string;
  parentId?: string;
  team: string;
  retired: boolean;
  plan?: z.output<typeof blobRefSchema>;
  note?: string;
  createdBy: string;
}
interface State {
  places: Record<string, Place>;
}

const places = defineCollection({
  type: 'place',
  resourceType: 'Place',
  item: z.strictObject({
    id: recordKeySchema,
    name: z.string().min(1).max(80),
    parentId: recordKeySchema.optional(),
    team: z.string(),
    retired: z.boolean(),
    plan: blobRefSchema.optional(),
    note: z.string().max(80).optional(),
    createdBy: z.string(),
  }),
  label: { one: 'Place', many: 'Places' },
  titleField: 'name',
  parent: 'parentId',
  retiredField: 'retired',
});
const limits = { maxBytes: 1024, mediaTypes: ['application/pdf'] };
const ops = {
  create: collectionCreate(places, {
    id: 'place',
    description: 'Add a place.',
    fields: ['name', 'parentId', 'team', 'plan'],
    blobs: limits,
  }),
  record: collectionCreate(places, {
    id: 'place.record',
    description: 'Add a place with a key made on the device.',
    fields: ['name', 'team'],
    clientKey: true,
  }),
  update: collectionUpdate(places, {
    id: 'place',
    description: 'Rename a place or replace its plan.',
    fields: ['name', 'plan', 'note'],
    blobs: limits,
  }),
  retire: collectionRetire(places, { id: 'place', description: 'Retire a place.' }),
  move: collectionMove(places, { id: 'place', description: 'Move a place.' }),
  tree: collectionTree(places, { id: 'place', description: 'The places depth first.' }),
};

const place = (id: string, parentId?: string, team = 'red'): Place => ({
  id,
  name: id.toUpperCase(),
  ...(parentId ? { parentId } : {}),
  team,
  retired: false,
  createdBy: 'seed',
});
const teams: Record<string, string[]> = { ann: ['red', 'blue'], bob: ['blue'] };
const visible = (record: Place, ctx: { context: { principalId: string } }) =>
  teams[ctx.context.principalId]?.includes(record.team) ?? false;

function setup() {
  let ids = 0;
  const store = createMemoryBlobStore(() => 1_000);
  const storage = createMemoryStorage<State>({
    places: {
      plant: place('plant'),
      hall: place('hall', 'plant'),
      bay: place('bay', 'hall'),
      yard: place('yard', 'plant', 'blue'),
      shed: place('shed', 'yard', 'blue'),
    },
  });
  const app = createApplication({
    modules: [defineModule({ id: 'places', capabilities: Object.values(ops) })],
    storage,
    services: {},
    now: () => 1_000,
    blobStore: () => store,
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    handlers: [
      ...collectionCommandHandlers<State, {}, Place>(
        places,
        { create: ops.create, update: ops.update, retire: ops.retire, move: ops.move },
        {
          store: (state) => state.places,
          visible,
          newKey: () => `p${++ids}`,
          defaults: (ctx) => ({ retired: false, createdBy: ctx.context.principalId }),
          normalize: (record) => ({ ...record, name: record.name.trim() }),
          validate(record, ctx, previous) {
            const clash = Object.values(ctx.state.places).find(
              (other) => other.id !== record.id && other.name === record.name && !other.retired,
            );
            if (clash && record.name !== previous?.name)
              throw new ApplicationError('CONFLICT', `${record.name} exists`);
          },
        },
      ),
      ...collectionCommandHandlers<State, {}, Place>(
        places,
        { create: ops.record },
        {
          store: (state) => state.places,
          defaults: () => ({ retired: false, createdBy: 'device' }),
        },
      ),
      collectionTreeHandler<State, {}, typeof ops.tree, Place>(places, ops.tree, {
        store: (state) => state.places,
        visible,
      }),
    ],
  });
  const snapshot = () => storage.read('w', async (value) => structuredClone(value));
  return { app, snapshot };
}
const ann = { workspaceId: 'w', principalId: 'ann' };
const bob = { workspaceId: 'w', principalId: 'bob' };
let keys = 0;
const run = (
  app: ReturnType<typeof setup>['app'],
  operation: string,
  input: object,
  context = ann,
) => app.invoke({ operation, input, idempotencyKey: `k${++keys}` } as never, context);
const code = (error: unknown) => (error as { code?: string }).code;

describe('generated collection commands', () => {
  test('the contracts take the key as id and keep managed fields out of update', () => {
    expect(Object.keys(ops.record.input.jsonSchema.properties as object)).toEqual([
      'id',
      'name',
      'team',
    ]);
    expect(ops.update.input.jsonSchema.required).toEqual(['id']);
    expect(Object.keys(ops.move.input.jsonSchema.properties as object)).toEqual(['id', 'parentId']);
    expect(ops.tree.output.jsonSchema).toMatchObject({ required: ['items', 'total'] });
    expect(() =>
      collectionUpdate(places, { id: 'place', description: 'x', fields: ['parentId'] }),
    ).toThrow('update cannot');
    expect(() =>
      collectionCreate(places, { id: 'place', description: 'x', fields: ['id'] }),
    ).toThrow('not as a field');
    const flat = defineCollection({
      type: 'flat',
      resourceType: 'Flat',
      item: z.strictObject({ id: recordKeySchema }),
    });
    expect(() => collectionMove(flat, { id: 'flat', description: 'x' })).toThrow('no parent');
    expect(() => collectionRetire(flat, { id: 'flat', description: 'x' })).toThrow('retiredField');
  });

  test('create keys, defaults, normalizes and validates a record under a visible parent', async () => {
    const { app } = setup();
    const created = await run(app, 'place.create', {
      name: ' Lab ',
      parentId: 'hall',
      team: 'red',
    });
    expect(created.result).toEqual({
      id: 'p1',
      name: 'Lab',
      parentId: 'hall',
      team: 'red',
      retired: false,
      createdBy: 'ann',
    });
    expect(created.revisions).toEqual({ 'place:p1': 1 });
    expect(await run(app, 'place.create', { name: 'Lab', team: 'red' }).catch(code)).toBe(
      'CONFLICT',
    );
    // Bob cannot see the red hall, so it is no parent of his.
    expect(
      await run(app, 'place.create', { name: 'Den', parentId: 'hall', team: 'blue' }, bob).catch(
        code,
      ),
    ).toBe('NOT_FOUND');
    const device = await run(app, 'place.record.create', { id: 'dev-1', name: 'Hut', team: 'red' });
    expect(device.result).toMatchObject({ id: 'dev-1', createdBy: 'device' });
    expect(
      await run(app, 'place.record.create', { id: 'dev-1', name: 'Hut 2', team: 'red' }).catch(
        code,
      ),
    ).toBe('CONFLICT');
  });

  test('update changes supplied fields; a hidden record is missing and a retired one fixed', async () => {
    const { app } = setup();
    const renamed = await run(app, 'place.update', { id: 'bay', name: 'Bay 1' });
    expect(renamed.result).toMatchObject({ id: 'bay', name: 'Bay 1', parentId: 'hall' });
    expect(await run(app, 'place.update', { id: 'bay', name: 'x' }, bob).catch(code)).toBe(
      'NOT_FOUND',
    );
    await run(app, 'place.retire', { id: 'bay' });
    expect(await run(app, 'place.update', { id: 'bay', name: 'Bay 2' }).catch(code)).toBe(
      'CONFLICT',
    );
    expect(await run(app, 'place.retire', { id: 'bay' }).catch(code)).toBe('CONFLICT');
  });

  test('update takes null to clear a field the item may leave out, never a required one', async () => {
    const { app } = setup();
    const noted = await run(app, 'place.update', { id: 'bay', note: 'Door sticks' });
    expect(noted.result).toMatchObject({ note: 'Door sticks' });
    const cleared = await run(app, 'place.update', { id: 'bay', note: null });
    expect(cleared.result).not.toHaveProperty('note');
    expect(await run(app, 'place.update', { id: 'bay', name: null }).catch(code)).toBe(
      'INVALID_INPUT',
    );
  });

  test('retire needs the children retired or moved first', async () => {
    const { app } = setup();
    expect(await run(app, 'place.retire', { id: 'hall' }).catch(code)).toBe('CONFLICT');
    await run(app, 'place.retire', { id: 'bay' });
    const retired = await run(app, 'place.retire', { id: 'hall' });
    expect(retired.result).toMatchObject({ retired: true });
    expect(
      await run(app, 'place.create', { name: 'Lab', parentId: 'hall', team: 'red' }).catch(code),
    ).toBe('CONFLICT');
  });

  test('move refuses a cycle and a retired parent, and moves to the root with null', async () => {
    const { app, snapshot } = setup();
    expect(await run(app, 'place.move', { id: 'plant', parentId: 'bay' }).catch(code)).toBe(
      'INVALID_INPUT',
    );
    expect(await run(app, 'place.move', { id: 'hall', parentId: 'hall' }).catch(code)).toBe(
      'INVALID_INPUT',
    );
    const moved = await run(app, 'place.move', { id: 'hall', parentId: 'yard' });
    expect(moved.result).toMatchObject({ parentId: 'yard' });
    const root = await run(app, 'place.move', { id: 'hall', parentId: null });
    expect(root.result).not.toHaveProperty('parentId');
    const events = await app.events(0, ann);
    expect(events.events.map((event) => event.type)).toEqual(['moved', 'moved']);
    const { state } = await snapshot();
    expect(subtree(places, state.places, 'plant').map((record) => record.id)).toEqual([
      'plant',
      'yard',
      'shed',
    ]);
    expect(ancestors(places, state.places, 'bay').map((record) => record.id)).toEqual(['hall']);
  });

  test('a blob a field references is attached, and a replaced one detached', async () => {
    const { app, snapshot } = setup();
    const first = await app.putBlob(new Uint8Array([1, 2, 3]), 'application/pdf', ann);
    const created = await run(app, 'place.create', { name: 'Lab', team: 'red', plan: first });
    expect((await snapshot()).blobs[first.digest]?.resources).toEqual(['place:p1']);
    const second = await app.putBlob(new Uint8Array([4, 5]), 'application/pdf', ann);
    await run(app, 'place.update', { id: (created.result as Place).id, plan: second });
    const { blobs } = await snapshot();
    expect(blobs[first.digest]?.resources ?? []).toEqual([]);
    expect(blobs[second.digest]?.resources).toEqual(['place:p1']);
  });

  test('the tree walks visible records depth first within depth and limit', async () => {
    const { app } = setup();
    const all = await app.query({ operation: 'place.tree', input: {} }, ann);
    expect(all.data.items.map((item) => [item.id, item.depth])).toEqual([
      ['plant', 0],
      ['hall', 1],
      ['bay', 2],
      ['yard', 1],
      ['shed', 2],
    ]);
    // Bob cannot see the plant, so the yard starts a tree of its own.
    const blue = await app.query({ operation: 'place.tree', input: {} }, bob);
    expect(blue.data.items.map((item) => [item.id, item.depth])).toEqual([
      ['yard', 0],
      ['shed', 1],
    ]);
    const shallow = await app.query(
      { operation: 'place.tree', input: { root: 'plant', depth: 1, limit: 2 } },
      ann,
    );
    expect(shallow.data).toMatchObject({ total: 3 });
    expect(shallow.data.items.map((item) => item.id)).toEqual(['plant', 'hall']);
    await expect(
      app.query({ operation: 'place.tree', input: { root: 'plant' } }, bob),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await run(app, 'place.retire', { id: 'bay' });
    const active = await app.query({ operation: 'place.tree', input: { root: 'hall' } }, ann);
    expect(active.data.items.map((item) => item.id)).toEqual(['hall']);
    const withRetired = await app.query(
      { operation: 'place.tree', input: { root: 'hall', includeRetired: true } },
      ann,
    );
    expect(withRetired.data.items.map((item) => item.id)).toEqual(['hall', 'bay']);
  });
});

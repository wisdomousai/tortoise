import { expect, test } from 'bun:test';
import { z } from 'zod';
import {
  buildCatalog,
  collectionCreate,
  collectionGet,
  collectionList,
  collectionMove,
  collectionRetire,
  collectionTree,
  collectionUpdate,
  defineCapability,
  defineCollection,
  defineDataProvider,
  defineModule,
  jsonSchema,
  listFilters,
  listSortFields,
  type DisplayDeclaration,
} from '../src';

const item = z.strictObject({ id: z.string(), title: z.string(), size: z.number() });
const catalogOf = (display: DisplayDeclaration, output: z.ZodType = item) =>
  buildCatalog([
    defineModule({
      id: 'm',
      capabilities: [
        defineCapability({
          id: 'thing.make',
          kind: 'command',
          input: jsonSchema(z.strictObject({})),
          output: jsonSchema(output),
          permission: { action: 'write', resourceType: 'Thing' },
          ui: { exception: 'test' },
          display,
        }),
      ],
    }),
  ]);

test('a collection carries its names, resource kind, title field and fields into the catalog', () => {
  const things = defineCollection({
    type: 'thing',
    resourceType: 'Thing',
    item,
    label: { one: 'Thing', many: 'Things' },
    titleField: 'title',
    fields: [{ name: 'title' }, { name: 'size', label: 'Size (mm)' }],
  });
  const catalog = buildCatalog([
    defineModule({
      id: 'things',
      capabilities: [
        collectionList(things, { id: 'thing', description: 'List things.' }),
        collectionGet(things, { id: 'thing', description: 'Read a thing.' }),
      ],
    }),
  ]);
  const shown = Object.fromEntries(catalog.operations.map((op) => [op.id, op.display]));
  expect(shown['thing.list']).toEqual({
    label: 'Things',
    resource: 'thing',
    key: 'id',
    titleField: 'title',
    fields: [{ name: 'title' }, { name: 'size', label: 'Size (mm)' }],
  });
  expect(shown['thing.get']).toMatchObject({ label: 'Thing', resource: 'thing' });
});

test('display fields are checked against the output record, or a list item', () => {
  expect(() => catalogOf({ titleField: 'title', fields: [{ name: 'size' }] })).not.toThrow();
  expect(() =>
    catalogOf({ titleField: 'title' }, z.strictObject({ items: z.array(item) })),
  ).not.toThrow();
  expect(() => catalogOf({ titleField: 'name' })).toThrow('Display title field name');
  expect(() => catalogOf({ fields: [{ name: 'size' }, { name: 'size' }] })).toThrow('repeats');
  expect(() => catalogOf({ fields: [] })).toThrow('must not be empty');
  expect(() => catalogOf({ resource: 'thing', key: 'ref' })).toThrow('Display key ref');
  expect(() => catalogOf({ resource: 'Thing' })).toThrow('resource kind');
  expect(() => catalogOf({ key: 'id' })).toThrow('needs a resource');
  expect(() => catalogOf({ label: 'two\nlines' })).toThrow('one line');
});

test('display fields carry a kind, status tones and a reference, each checked', () => {
  expect(() =>
    catalogOf({
      fields: [
        { name: 'title', kind: 'reference', reference: 'thing' },
        { name: 'size', kind: 'status', tones: { big: 'warning' } },
      ],
    }),
  ).not.toThrow();
  expect(() => catalogOf({ fields: [{ name: 'size', tones: { big: 'warning' } }] })).not.toThrow();
  expect(() => catalogOf({ fields: [{ name: 'size', kind: 'badge' as 'status' }] })).toThrow(
    'kind of size is unknown',
  );
  expect(() => catalogOf({ fields: [{ name: 'size', kind: 'date', tones: {} }] })).toThrow(
    'tones need a status field',
  );
  expect(() =>
    catalogOf({ fields: [{ name: 'size', tones: { big: 'loud' as 'warning' } }] }),
  ).toThrow('tone of size is unknown');
  expect(() => catalogOf({ fields: [{ name: 'title', kind: 'reference' }] })).toThrow(
    'names no collection',
  );
  expect(() => catalogOf({ fields: [{ name: 'title', reference: 'Thing' }] })).toThrow(
    'must be a resource kind',
  );
  expect(() =>
    catalogOf({ fields: [{ name: 'title', kind: 'text', reference: 'thing' }] }),
  ).toThrow('needs a reference field');
});

test('a list declares sort fields as a sortBy choice, and an update clears optional fields with null', async () => {
  const things = defineCollection({
    type: 'thing',
    resourceType: 'Thing',
    item: z.strictObject({
      id: z.string(),
      title: z.string(),
      size: z.number(),
      note: z.string().optional(),
      owner: z.string().nullable(),
    }),
  });
  const list = collectionList(things, { id: 'thing', description: 'List.', sort: ['size'] });
  expect(listSortFields(list)).toEqual(['size']);
  expect(listFilters(list)).toEqual([]);
  expect(() =>
    collectionList(things, { id: 'thing', description: 'List.', sort: ['weight' as 'size'] }),
  ).toThrow('sort field is not an item field');
  const update = collectionUpdate(things, {
    id: 'thing',
    description: 'Save.',
    fields: ['title', 'note', 'owner'],
  });
  const accepts = (input: object) => update.input['~standard'].validate(input);
  expect(await accepts({ id: 't', note: null })).not.toHaveProperty('issues');
  expect(await accepts({ id: 't', owner: null })).not.toHaveProperty('issues');
  expect(await accepts({ id: 't', title: null })).toHaveProperty('issues');
});

test('a collection title field must be an item field', () => {
  expect(() =>
    defineCollection({
      type: 'thing',
      resourceType: 'Thing',
      item,
      titleField: 'name' as 'title',
    }),
  ).toThrow('Collection title field is not an item field: name');
});

test('a data provider shows found records with its display fields and no resource kind', () => {
  const provider = defineDataProvider({
    id: 'crm.account',
    target: 'crm',
    identity: 'caller',
    resourceType: 'CrmAccount',
    query: z.strictObject({ text: z.string() }),
    item: z.strictObject({ externalId: z.string(), name: z.string() }),
    descriptions: { search: 'Search accounts.', lookup: 'Read an account.' },
    display: { search: 'Search accounts', titleField: 'name' },
  });
  expect(provider.search.display).toEqual({ label: 'Search accounts', titleField: 'name' });
  expect(provider.lookup.display).toEqual({ titleField: 'name' });
});

test('the inputs a collection generates are described for a model that reads the schema', () => {
  const plants = defineCollection({
    type: 'plant',
    resourceType: 'Plant',
    item: z.strictObject({
      id: z.string(),
      name: z.string().describe('The plant name.'),
      parentId: z.string().nullable(),
      retired: z.boolean(),
    }),
    label: { one: 'plant', many: 'plants' },
    parent: 'parentId',
    retiredField: 'retired',
  });
  const spec = { id: 'plant', description: 'Plants.' } as const;
  const capabilities = [
    collectionGet(plants, spec),
    collectionList(plants, { ...spec, search: true, filters: ['name'] }),
    collectionCreate(plants, { ...spec, fields: ['name'], clientKey: true }),
    collectionUpdate(plants, { ...spec, fields: ['name'] }),
    collectionRetire(plants, spec),
    collectionMove(plants, spec),
    collectionTree(plants, spec),
  ];
  for (const capability of capabilities) {
    const properties = capability.input.jsonSchema.properties as Record<
      string,
      { description?: string }
    >;
    for (const [field, property] of Object.entries(properties))
      expect([capability.id, field, typeof property.description]).toEqual([
        capability.id,
        field,
        'string',
      ]);
  }
});

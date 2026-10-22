import { expect, test } from 'bun:test';
import { z } from 'zod';
import {
  buildCatalog,
  collectionGet,
  collectionList,
  defineCapability,
  defineCollection,
  defineDataProvider,
  defineModule,
  jsonSchema,
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

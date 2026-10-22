import { z } from 'zod';
import { defineCapability } from './capability';
import type { DisplayField } from './display';
import { jsonSchema } from './schema';

/** Record keys: non-empty, bounded, and used verbatim in journal resources (`<type>:<key>`). */
export const recordKeySchema = z.string().min(1).max(128);

export interface CollectionSpec<Type extends string, Item extends z.ZodObject> {
  /** Journal resource prefix: every record is the resource `<type>:<key>`. No `:` allowed. */
  readonly type: Type;
  /** Permission subject of the generated operations, for example `CrmAccount`. */
  readonly resourceType: string;
  /** What a caller sees of one record. The stored record may hold more. */
  readonly item: Item;
  /** Field of `item` that holds the key; `id` when omitted. */
  readonly key?: keyof Item['shape'] & string;
  /** Field that names the record's container (project, plant, station) for membership scoping. */
  readonly container?: keyof Item['shape'] & string;
  /** Names for generated screens and descriptions. */
  readonly label?: { readonly one: string; readonly many: string };
  /** Field of `item` that names a record; generated screens and agents show it. */
  readonly titleField?: keyof Item['shape'] & string;
  /** Fields of `item` that generated screens show, in order; the scalar fields when omitted. */
  readonly fields?: readonly DisplayField[];
}

/**
 * Declare a typed set of records that a module keeps in its state slice. This is data: it names
 * the journal resource type, the visible record and its key, so handlers, generated operations
 * and default screens agree on them. It is not an ORM; the records stay a plain keyed object in
 * the module's slice and commit with the rest of the state. Browser-safe.
 */
export function defineCollection<const Type extends string, Item extends z.ZodObject>(
  spec: CollectionSpec<Type, Item>,
) {
  if (!/^[a-z][a-z0-9-]*$/.test(spec.type))
    throw new Error(`Collection type must be lowercase letters, digits and hyphens: ${spec.type}`);
  const key = spec.key ?? 'id';
  if (!(key in spec.item.shape)) throw new Error(`Collection key is not an item field: ${key}`);
  if (spec.container && !(spec.container in spec.item.shape))
    throw new Error(`Collection container is not an item field: ${spec.container}`);
  if (spec.titleField && !(spec.titleField in spec.item.shape))
    throw new Error(`Collection title field is not an item field: ${spec.titleField}`);
  return Object.freeze({
    type: spec.type,
    resourceType: spec.resourceType,
    item: spec.item,
    key,
    ...(spec.container ? { container: spec.container } : {}),
    label: spec.label ?? { one: spec.type, many: `${spec.type}s` },
    ...(spec.titleField ? { titleField: spec.titleField } : {}),
    ...(spec.fields ? { fields: spec.fields } : {}),
    /** The journal resource of one record. */
    resource: (id: string): `${Type}:${string}` => `${spec.type}:${id}`,
  });
}
export type Collection<
  Type extends string = string,
  Item extends z.ZodObject = z.ZodObject,
> = ReturnType<typeof defineCollection<Type, Item>>;

/** A UI binding, or the reason an operation has none. Defaults to binding the operation. */
type UiDeclaration = { readonly binding?: string; readonly exception?: string };

export interface CollectionReadSpec<Id extends string> {
  /** Operation prefix, for example `crm.account`; yields `<id>.get` or `<id>.list`. */
  readonly id: Id;
  readonly description: string;
  /** Resources other than the collection's own whose changes refresh the query. */
  readonly dependencies?: readonly string[];
  readonly ui?: UiDeclaration;
}
export interface CollectionListSpec<
  Id extends string,
  Filters extends string,
> extends CollectionReadSpec<Id> {
  /** Item fields a list may filter on by equality. Each becomes an optional input field. */
  readonly filters?: readonly Filters[];
  /**
   * Adds an optional `search` input: case-insensitive text the server matches against each
   * visible record's search text (`searchText` in the handler). Never match hidden fields.
   */
  readonly search?: boolean;
}

/** The largest page a generated list returns. */
export const MAX_PAGE = 100;

const readPermission = (collection: Collection) => ({
  action: 'read',
  resourceType: collection.resourceType,
});

/** A generated read's display: the collection's names, resource kind, key and fields. */
const readDisplay = (collection: Collection, label: string) => ({
  label,
  resource: collection.type,
  key: collection.key,
  ...(collection.titleField ? { titleField: collection.titleField } : {}),
  ...(collection.fields ? { fields: collection.fields } : {}),
});

/**
 * Generate `<id>.get`: one record by key, or `NOT_FOUND` when it is absent or the caller may not
 * see it. Requires `read` on the collection's resource type. The server pairs it with
 * `collectionGetHandler` from `@agent-native/runtime`, which supplies the visibility rule.
 */
export function collectionGet<
  const Id extends string,
  Type extends string,
  Item extends z.ZodObject,
>(collection: Collection<Type, Item>, spec: CollectionReadSpec<Id>) {
  return defineCapability({
    id: `${spec.id}.get` as `${Id}.get`,
    kind: 'query',
    description: spec.description,
    input: jsonSchema(z.strictObject({ id: recordKeySchema })),
    output: jsonSchema(collection.item as unknown as z.ZodType<z.output<Item>>),
    permission: readPermission(collection),
    dependencies: [collection.type, ...(spec.dependencies ?? [])],
    ui: spec.ui ?? { binding: `${spec.id}.get` },
    display: readDisplay(collection, collection.label.one),
  });
}

/**
 * Generate `<id>.list`: the records the caller may see, filtered by equality on `filters`, then
 * counted and paged by `offset` and `limit`. Scoping always comes first, so `total` counts visible
 * rows only. Requires `read` on the collection's resource type. The server pairs it with
 * `collectionListHandler` from `@agent-native/runtime`.
 */
export function collectionList<
  const Id extends string,
  Type extends string,
  Item extends z.ZodObject,
  const Filters extends keyof Item['shape'] & string = never,
>(collection: Collection<Type, Item>, spec: CollectionListSpec<Id, Filters>) {
  const filterShape: Record<string, z.ZodOptional> = {};
  for (const field of spec.filters ?? []) {
    const schema = collection.item.shape[field] as z.ZodType | undefined;
    if (!schema) throw new Error(`Collection filter is not an item field: ${field}`);
    filterShape[field] = schema.optional();
  }
  return defineCapability({
    id: `${spec.id}.list` as `${Id}.list`,
    kind: 'query',
    description: spec.description,
    input: jsonSchema(
      z.strictObject({
        ...filterShape,
        ...(spec.search ? { search: z.string().max(100).optional() } : {}),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(MAX_PAGE).optional(),
      }) as unknown as z.ZodType<CollectionListInput<z.output<Item>, Filters>>,
    ),
    output: jsonSchema(
      z.strictObject({
        items: z.array(collection.item),
        total: z.number().int().min(0),
      }) as unknown as z.ZodType<CollectionPage<z.output<Item>>>,
    ),
    permission: readPermission(collection),
    dependencies: [collection.type, ...(spec.dependencies ?? [])],
    ui: spec.ui ?? { binding: `${spec.id}.list` },
    display: readDisplay(collection, collection.label.many),
  });
}
export type CollectionListInput<Item, Filters extends keyof Item> = {
  readonly [F in Filters]?: Item[F];
} & { readonly search?: string; readonly offset?: number; readonly limit?: number };
export interface CollectionPage<Item> {
  readonly items: Item[];
  /** Visible records matching the filters, before paging. */
  readonly total: number;
}

/** The equality filters of a generated list: its input fields other than search and paging. */
export function listFilters(list: { readonly input: { readonly jsonSchema: object } }): string[] {
  return listInputFields(list).filter((field) => !listControls.has(field));
}
/** Whether a generated list accepts `search`. */
export const listSearches = (list: { readonly input: { readonly jsonSchema: object } }) =>
  listInputFields(list).includes('search');
const listControls = new Set(['search', 'offset', 'limit']);
function listInputFields(list: { readonly input: { readonly jsonSchema: object } }) {
  const properties = (list.input.jsonSchema as { properties?: Record<string, unknown> }).properties;
  return Object.keys(properties ?? {});
}

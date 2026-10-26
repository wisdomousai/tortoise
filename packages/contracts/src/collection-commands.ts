import { z } from 'zod';
import { assertBlobLimits, type BlobLimits } from './blob';
import { defineCapability } from './capability';
import { readDisplay, readPermission, type UiDeclaration } from './collection-display';
import { recordKeySchema, type Collection } from './collection';
import { jsonSchema } from './schema';

export interface CollectionCommandSpec<Id extends string> {
  /** Operation prefix, for example `crm.account`; yields `<id>.create`, `<id>.update` and so on. */
  readonly id: Id;
  readonly description: string;
  /** Permission action required on the collection's resource type; `write` when omitted. */
  readonly action?: string;
  /** Resources other than the collection's own that the command reads. */
  readonly dependencies?: readonly string[];
  readonly ui?: UiDeclaration;
  /** Operations the handler's hooks run inside the transaction. */
  readonly invokes?: readonly string[];
}
export interface CollectionFieldsSpec<
  Id extends string,
  Fields extends string,
> extends CollectionCommandSpec<Id> {
  /**
   * Item fields the caller supplies, with the item's own schemas and optionality. Never the key;
   * the parent and retired fields only on create.
   */
  readonly fields: readonly Fields[];
  /**
   * Limits on the blobs the fields reference. The handler attaches each referenced blob to the
   * record, so whoever may read the record may read the file.
   */
  readonly blobs?: BlobLimits;
}

/** The most records one generated tree read returns. */
export const MAX_TREE = 1000;

const writePermission = (collection: Collection, spec: CollectionCommandSpec<string>) => ({
  action: spec.action ?? 'write',
  resourceType: collection.resourceType,
});

/** The shared parts of every generated command. */
function command<const Id extends string, I, O>(
  collection: Collection,
  id: Id,
  spec: CollectionCommandSpec<string> & { readonly blobs?: BlobLimits },
  input: z.ZodType<I>,
  output: z.ZodType<O>,
  label: string,
) {
  if (spec.blobs) assertBlobLimits(spec.blobs, id);
  return defineCapability({
    id,
    kind: 'command',
    description: spec.description,
    input: jsonSchema(input),
    output: jsonSchema(output),
    permission: writePermission(collection, spec),
    dependencies: [collection.type, ...(spec.dependencies ?? [])],
    ui: spec.ui ?? { binding: id },
    display: readDisplay(collection, label),
    ...(spec.blobs ? { blobs: spec.blobs } : {}),
    ...(spec.invokes ? { invokes: spec.invokes } : {}),
  });
}

/** The item schemas of `fields`, refusing the key and, outside create, the managed fields. */
function picked(collection: Collection, fields: readonly string[], create: boolean) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    const schema = collection.item.shape[field] as z.ZodType | undefined;
    if (!schema) throw new Error(`Collection field is not an item field: ${field}`);
    if (field === collection.key || field === 'id')
      throw new Error(`Collection commands take the key as id, not as a field: ${field}`);
    if (!create && (field === collection.parent || field === collection.retiredField))
      throw new Error(`Move or retire changes ${field}; update cannot`);
    shape[field] = schema;
  }
  return shape;
}

const item = <Item extends z.ZodObject>(collection: Collection<string, Item>) =>
  collection.item as unknown as z.ZodType<z.output<Item>>;

/**
 * Generate `<id>.create`: a new record from `fields`. The server picks the key, unless
 * `clientKey` lets the caller supply it as `id`, for records made where the instance is not
 * reachable, such as on a phone. A key that exists is `CONFLICT`. The server pairs it with
 * `collectionCommandHandlers` from `@agent-native/runtime`, which checks a tree's parent.
 */
export function collectionCreate<
  const Id extends string,
  Type extends string,
  Item extends z.ZodObject,
  const Fields extends keyof Item['shape'] & string,
  const ClientKey extends boolean = false,
>(
  collection: Collection<Type, Item>,
  spec: CollectionFieldsSpec<Id, Fields> & { readonly clientKey?: ClientKey },
) {
  const shape = picked(collection, spec.fields, true);
  const input = z.strictObject({
    ...(spec.clientKey ? { id: recordKeySchema } : {}),
    ...shape,
  }) as unknown as z.ZodType<CollectionCreateInput<z.output<Item>, Fields, ClientKey>>;
  return command(
    collection,
    `${spec.id}.create` as `${Id}.create`,
    spec,
    input,
    item(collection),
    `New ${collection.label.one}`,
  );
}
export type CollectionCreateInput<Item, Fields extends keyof Item, ClientKey extends boolean> = {
  readonly [F in Fields]: Item[F];
} & (ClientKey extends true ? { readonly id: string } : unknown);

/**
 * Generate `<id>.update`: change `fields` of one record; a field left out keeps its value. A
 * missing or hidden record is `NOT_FOUND`, a retired one `CONFLICT`. Requires `write` (or
 * `action`) on the collection's resource type.
 */
export function collectionUpdate<
  const Id extends string,
  Type extends string,
  Item extends z.ZodObject,
  const Fields extends keyof Item['shape'] & string,
>(collection: Collection<Type, Item>, spec: CollectionFieldsSpec<Id, Fields>) {
  const shape = picked(collection, spec.fields, false);
  const optional = Object.fromEntries(
    Object.entries(shape).map(([field, schema]) => [field, schema.optional()]),
  );
  const input = z.strictObject({
    id: recordKeySchema,
    ...optional,
  }) as unknown as z.ZodType<CollectionUpdateInput<z.output<Item>, Fields>>;
  return command(
    collection,
    `${spec.id}.update` as `${Id}.update`,
    spec,
    input,
    item(collection),
    `Save ${collection.label.one}`,
  );
}
export type CollectionUpdateInput<Item, Fields extends keyof Item> = {
  readonly [F in Fields]?: Item[F];
} & { readonly id: string };

/**
 * Generate `<id>.retire` for a collection with a `retiredField`: mark one record retired. It
 * keeps its history and stays readable, but no command changes it again. In a tree, its active
 * children must be retired or moved first.
 */
export function collectionRetire<
  const Id extends string,
  Type extends string,
  Item extends z.ZodObject,
>(collection: Collection<Type, Item>, spec: CollectionCommandSpec<Id>) {
  if (!collection.retiredField)
    throw new Error(`Collection ${collection.type} declares no retiredField to retire with`);
  return command(
    collection,
    `${spec.id}.retire` as `${Id}.retire`,
    spec,
    z.strictObject({ id: recordKeySchema }),
    item(collection),
    `Retire ${collection.label.one}`,
  );
}

/**
 * Generate `<id>.move` for a tree collection: put one record and its subtree under another
 * parent, or at the root with the parent `null`. Moving a record under itself or a descendant is
 * `INVALID_INPUT`; a retired parent is `CONFLICT`.
 */
export function collectionMove<
  const Id extends string,
  Type extends string,
  Item extends z.ZodObject,
>(collection: Collection<Type, Item>, spec: CollectionCommandSpec<Id>) {
  const parent = collection.parent;
  if (!parent) throw new Error(`Collection ${collection.type} declares no parent to move under`);
  const input = z.strictObject({
    id: recordKeySchema,
    [parent]: recordKeySchema.nullable(),
  }) as unknown as z.ZodType<{ readonly id: string } & Record<string, string | null>>;
  return command(
    collection,
    `${spec.id}.move` as `${Id}.move`,
    spec,
    input,
    item(collection),
    `Move ${collection.label.one}`,
  );
}

export interface CollectionTreeSpec<Id extends string> {
  /** Operation prefix; yields `<id>.tree`. */
  readonly id: Id;
  readonly description: string;
  /** Resources other than the collection's own whose changes refresh the query. */
  readonly dependencies?: readonly string[];
  readonly ui?: UiDeclaration;
}

/**
 * Generate `<id>.tree` for a tree collection: the visible records depth first from `root` (or
 * from every root), each with its `depth` below the start, down to `depth` levels and at most
 * `limit` records. `total` counts the visible records the walk reached before the limit. Retired
 * records are left out unless `includeRetired` is set. The server pairs it with
 * `collectionTreeHandler` from `@agent-native/runtime`.
 */
export function collectionTree<
  const Id extends string,
  Type extends string,
  Item extends z.ZodObject,
>(collection: Collection<Type, Item>, spec: CollectionTreeSpec<Id>) {
  if (!collection.parent)
    throw new Error(`Collection ${collection.type} declares no parent to walk a tree by`);
  if ('depth' in collection.item.shape)
    throw new Error(`Collection ${collection.type} has a depth field, which a tree read adds`);
  const input = z.strictObject({
    root: recordKeySchema.optional(),
    depth: z.number().int().min(0).max(64).optional(),
    ...(collection.retiredField ? { includeRetired: z.boolean().optional() } : {}),
    limit: z.number().int().min(1).max(MAX_TREE).optional(),
  }) as unknown as z.ZodType<CollectionTreeInput>;
  const output = z.strictObject({
    items: z.array(collection.item.extend({ depth: z.number().int().min(0) })),
    total: z.number().int().min(0),
  }) as unknown as z.ZodType<CollectionTreePage<z.output<Item>>>;
  return defineCapability({
    id: `${spec.id}.tree` as `${Id}.tree`,
    kind: 'query',
    description: spec.description,
    input: jsonSchema(input),
    output: jsonSchema(output),
    permission: readPermission(collection),
    dependencies: [collection.type, ...(spec.dependencies ?? [])],
    ui: spec.ui ?? { binding: `${spec.id}.tree` },
    display: readDisplay(collection, collection.label.many),
  });
}
export interface CollectionTreeInput {
  readonly root?: string;
  readonly depth?: number;
  readonly includeRetired?: boolean;
  readonly limit?: number;
}
export interface CollectionTreePage<Item> {
  readonly items: (Item & { readonly depth: number })[];
  /** Visible records the walk reached, before the limit. */
  readonly total: number;
}

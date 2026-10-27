import {
  ApplicationError,
  isBlobRef,
  MAX_TREE,
  type AnyCapability,
  type BlobRef,
  type Collection,
  type CollectionTreeInput,
  type CollectionTreePage,
  type OutputOf,
} from '@agent-native/contracts';
import { byCodePoint } from './application/records.js';
import { own, records, type CollectionReadOptions } from './collection.js';
import type { HandlerContext, HandlerContribution } from './types.js';

type Tree = Pick<Collection, 'key' | 'parent'>;
type Command = AnyCapability & { readonly kind: 'command' };
type Query = AnyCapability & { readonly kind: 'query' };
type Fields = Record<string, unknown>;

const field = (record: unknown, name: string) => (record as Fields | undefined)?.[name];
const keyOf = (collection: Pick<Collection, 'key'>, record: unknown) =>
  String(field(record, collection.key));
const retired = (collection: Pick<Collection, 'retiredField'>, record: unknown) =>
  !!collection.retiredField && field(record, collection.retiredField) === true;

/** Each parent key's children, in stored order. */
function childIndex<T>(collection: Tree, values: readonly T[]) {
  const children = new Map<string, T[]>();
  for (const record of values) {
    const parent = field(record, collection.parent!);
    if (typeof parent !== 'string') continue;
    const siblings = children.get(parent);
    if (siblings) siblings.push(record);
    else children.set(parent, [record]);
  }
  return children;
}

/**
 * A tree collection's record and its descendants, depth first, or nothing for a missing key.
 * Reads apply no policy. A cycle in stored data stops the walk instead of looping.
 */
export function subtree<T>(collection: Tree, store: Readonly<Record<string, T>>, id: string): T[] {
  if (!collection.parent) throw new Error('subtree needs a tree collection');
  const start = own(store, id);
  if (start === undefined) return [];
  const children = childIndex(collection, Object.values(store));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const stack: T[] = [start]; stack.length;) {
    const record = stack.pop()!;
    const key = keyOf(collection, record);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
    stack.push(...[...(children.get(key) ?? [])].reverse());
  }
  return out;
}

/** A tree collection's record's ancestors, from its root down to its parent. */
export function ancestors<T>(
  collection: Tree,
  store: Readonly<Record<string, T>>,
  id: string,
): T[] {
  if (!collection.parent) throw new Error('ancestors needs a tree collection');
  const path: T[] = [];
  const seen = new Set([id]);
  for (let at = field(own(store, id), collection.parent); typeof at === 'string';) {
    const record = own(store, at);
    if (record === undefined || seen.has(at)) break;
    seen.add(at);
    path.unshift(record);
    at = field(record, collection.parent);
  }
  return path;
}

/** The blobs a field value references: the value itself, or the items of an array. */
const refsOf = (value: unknown): BlobRef[] =>
  isBlobRef(value) ? [value] : Array.isArray(value) ? value.filter(isBlobRef) : [];

export interface CollectionCommands {
  readonly create?: Command;
  readonly update?: Command;
  readonly retire?: Command;
  readonly move?: Command;
}

export interface CollectionWriteOptions<State, Services, Stored> {
  /** The keyed object holding the records in the module's state slice. */
  readonly store: (state: State) => Record<string, Stored>;
  /**
   * Whether the caller may see a record, as for the reads: a hidden record or parent is
   * `NOT_FOUND`. Every record when omitted; the policy still authorizes the operation.
   */
  readonly visible?: (record: Stored, context: HandlerContext<State, Services>) => boolean;
  /** What the caller sees of the written record; the stored record when omitted. */
  readonly present?: (record: Stored, context: HandlerContext<State, Services>) => unknown;
  /** A new record's key, when the create takes none from the caller. */
  readonly newKey?: (context: HandlerContext<State, Services>) => string;
  /** Fields the server sets on a new record, such as its author and creation time. */
  readonly defaults?: (context: HandlerContext<State, Services>) => Partial<Stored>;
  /**
   * The record to store, from the record as the command would write it: canonical forms,
   * derived fields, change times. Runs for every command, before `validate`; `previous` is the
   * stored record, absent on create.
   */
  readonly normalize?: (
    record: Stored,
    context: HandlerContext<State, Services>,
    previous: Stored | undefined,
  ) => Stored;
  /**
   * Throw an `ApplicationError` to refuse the record as it would be stored, for a rule such as a
   * unique name. Runs for every command after the generated checks.
   */
  readonly validate?: (
    record: Stored,
    context: HandlerContext<State, Services>,
    previous: Stored | undefined,
  ) => void;
}

/**
 * Handlers for a collection's generated commands (`collectionCreate`, `collectionUpdate`,
 * `collectionRetire`, `collectionMove`). Each finds the record through the visibility rule,
 * refuses a retired one, checks a tree's parent and cycles, runs `normalize` and `validate`,
 * attaches the blobs the fields reference when the command declares blob limits, and writes
 * through `records`, which journals the record's resource. Policy authorizes the operation
 * before the handler runs.
 */
export function collectionCommandHandlers<State, Services, Stored>(
  collection: Pick<Collection, 'type' | 'key' | 'label' | 'parent' | 'retiredField'>,
  commands: CollectionCommands,
  options: CollectionWriteOptions<State, Services, Stored>,
): HandlerContribution<State, Services>[] {
  type Context = HandlerContext<State, Services>;
  const { label, parent, retiredField } = collection;
  const unavailable = (what = label.one) =>
    new ApplicationError('NOT_FOUND', `${what} unavailable`);
  const shown = (record: Stored | undefined, ctx: Context): record is Stored =>
    record !== undefined && (!options.visible || options.visible(record, ctx));
  const existing = (ctx: Context, id: string) => {
    const record = own(options.store(ctx.state), id);
    if (!shown(record, ctx)) throw unavailable();
    if (retired(collection, record))
      throw new ApplicationError('CONFLICT', `${label.one} is retired`, { id });
    return record;
  };
  const present = (record: Stored, ctx: Context) =>
    options.present ? options.present(record, ctx) : record;

  /** A parent the caller can see, active, and not the record itself or one of its descendants. */
  function checkParent(ctx: Context, id: string, parentKey: unknown) {
    if (!parent || typeof parentKey !== 'string') return;
    const store = options.store(ctx.state);
    const found = own(store, parentKey);
    if (!shown(found, ctx)) throw unavailable(`Parent ${label.one.toLowerCase()}`);
    if (retired(collection, found))
      throw new ApplicationError('CONFLICT', `Parent ${label.one.toLowerCase()} is retired`);
    // Walk up from the new parent: reaching the record means it would move under itself.
    const path = [found, ...ancestors(collection, store, parentKey)];
    if (path.some((record) => keyOf(collection, record) === id))
      throw new ApplicationError(
        'INVALID_INPUT',
        `A ${label.one.toLowerCase()} cannot move under itself`,
        {
          field: parent,
        },
      );
  }

  function write(
    ctx: Context,
    capability: Command,
    id: string,
    record: Stored,
    previous: Stored | undefined,
    eventType: string,
    supplied: Fields = {},
  ) {
    const next = options.normalize ? options.normalize(record, ctx, previous) : record;
    if (parent && field(next, parent) !== field(previous, parent))
      checkParent(ctx, id, field(next, parent));
    options.validate?.(next, ctx, previous);
    const rows = records(ctx, collection, options.store(ctx.state));
    if (capability.blobs) {
      const kept = new Set<string>();
      for (const name of Object.keys(supplied))
        for (const ref of refsOf(field(next, name))) {
          kept.add(ref.digest);
          ctx.attach(rows.resource(id), ref);
        }
      // A replaced file stops being readable through this record.
      for (const name of Object.keys(supplied))
        for (const ref of refsOf(field(previous, name)))
          if (!kept.has(ref.digest)) ctx.detach(rows.resource(id), ref.digest);
    }
    if (previous === undefined) rows.insert(id, next, eventType);
    else rows.set(id, next, eventType);
    return present(next, ctx);
  }

  const supplied = (input: unknown) =>
    Object.fromEntries(
      Object.entries(input as Fields).filter(
        ([name, value]) => name !== 'id' && value !== undefined,
      ),
    );
  const contributions: HandlerContribution<State, Services>[] = [];
  const { create, update, retire, move } = commands;
  if (create) {
    const clientKey = 'id' in ((create.input.jsonSchema.properties ?? {}) as object);
    if (!clientKey && !options.newKey)
      throw new Error(`${create.id} takes no key, so the handlers need newKey`);
    contributions.push({
      capability: create,
      handle(input, ctx) {
        const fields = supplied(input);
        const id = clientKey ? (input as { id: string }).id : options.newKey!(ctx);
        const record = { ...options.defaults?.(ctx), ...fields, [collection.key]: id } as Stored;
        return write(ctx, create, id, record, undefined, 'created', fields) as OutputOf<Command>;
      },
    });
  }
  if (update)
    contributions.push({
      capability: update,
      handle(input, ctx) {
        const { id } = input as { id: string };
        const previous = existing(ctx, id);
        const fields = supplied(input);
        const record = { ...structuredClone(previous), ...fields } as Stored;
        return write(ctx, update, id, record, previous, 'updated', fields) as OutputOf<Command>;
      },
    });
  if (retire) {
    if (!retiredField) throw new Error(`${retire.id} needs a collection with a retiredField`);
    contributions.push({
      capability: retire,
      handle(input, ctx) {
        const { id } = input as { id: string };
        const previous = existing(ctx, id);
        if (parent) {
          const active = Object.values(options.store(ctx.state)).filter(
            (record) => field(record, parent) === id && !retired(collection, record),
          );
          if (active.length)
            throw new ApplicationError('CONFLICT', 'Retire or move the children first', {
              children: active.length,
            });
        }
        const record = { ...structuredClone(previous), [retiredField]: true } as Stored;
        return write(ctx, retire, id, record, previous, 'retired') as OutputOf<Command>;
      },
    });
  }
  if (move) {
    if (!parent) throw new Error(`${move.id} needs a tree collection`);
    contributions.push({
      capability: move,
      handle(input, ctx) {
        const { id } = input as { id: string };
        const target = (input as Fields)[parent];
        const previous = existing(ctx, id);
        const record = structuredClone(previous) as Fields;
        if (target === null) delete record[parent];
        else record[parent] = target;
        return write(ctx, move, id, record as Stored, previous, 'moved') as OutputOf<Command>;
      },
    });
  }
  return contributions;
}

/**
 * The handler of a generated `<id>.tree` (`collectionTree`). It keeps the records the caller may
 * see (and, unless `includeRetired`, the active ones), so a record whose parent is hidden starts
 * a tree of its own; then walks depth first from `root` or every root in `order`, counts what the
 * walk reaches within `depth`, and returns the first `limit` records with their depth.
 */
export function collectionTreeHandler<State, Services, C extends Query, Stored>(
  collection: Pick<Collection, 'key' | 'label' | 'parent' | 'retiredField'>,
  capability: C,
  options: CollectionReadOptions<State, Services, Stored, unknown> & {
    /** Sibling order; key order (code points) when omitted. */
    readonly order?: (a: Stored, b: Stored) => number;
  },
): HandlerContribution<State, Services, C> {
  const parent = collection.parent;
  if (!parent) throw new Error(`${capability.id} needs a tree collection`);
  const order =
    options.order ??
    ((a: Stored, b: Stored) => byCodePoint(keyOf(collection, a), keyOf(collection, b)));
  return {
    capability,
    handle(input, ctx) {
      const args = input as CollectionTreeInput;
      const store = options.store(ctx.state);
      const kept = Object.values(store).filter(
        (record) =>
          options.visible(record, ctx) && (args.includeRetired || !retired(collection, record)),
      );
      const keys = new Set(kept.map((record) => keyOf(collection, record)));
      const children = childIndex(
        collection,
        kept.filter((record) => keys.has(String(field(record, parent)))),
      );
      let starts = kept.filter((record) => !keys.has(String(field(record, parent))));
      if (args.root !== undefined) {
        const root = own(store, args.root);
        if (root === undefined || !options.visible(root, ctx))
          throw new ApplicationError('NOT_FOUND', `${collection.label.one} unavailable`);
        starts = [root];
      }
      const limit = args.limit ?? MAX_TREE;
      const items: unknown[] = [];
      const seen = new Set<string>();
      let total = 0;
      const stack = starts.sort(order).map((record) => ({ record, depth: 0 }));
      for (stack.reverse(); stack.length;) {
        const { record, depth } = stack.pop()!;
        const key = keyOf(collection, record);
        if (seen.has(key)) continue;
        seen.add(key);
        total++;
        if (items.length < limit) {
          const shown = options.present ? options.present(record, ctx) : record;
          items.push({ ...(shown as object), depth });
        }
        if (args.depth !== undefined && depth >= args.depth) continue;
        const below = [...(children.get(key) ?? [])].sort(order).reverse();
        stack.push(...below.map((child) => ({ record: child, depth: depth + 1 })));
      }
      const page: CollectionTreePage<unknown> = { items: items as never, total };
      return page as OutputOf<C>;
    },
  };
}

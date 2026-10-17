import {
  ApplicationError,
  listFilters,
  listSearches,
  type AnyCapability,
  type Collection,
  type CollectionPage,
  type OutputOf,
} from '@agent-native/contracts';
import { byCodePoint, defineOwn } from './application/records.js';
import type { HandlerContext, HandlerContribution, RemoteItemOf } from './types.js';

/** A record of `records`, or undefined; inherited properties such as `__proto__` are never records. */
export function own<T>(records: Readonly<Record<string, T>>, id: string): T | undefined {
  return Object.hasOwn(records, id) ? records[id] : undefined;
}
/** Define rather than assign, so an untrusted key such as `__proto__` stays an ordinary key. */
export function put<T>(records: Record<string, T>, id: string, value: T): void {
  defineOwn(records, id, value);
}

/**
 * One collection's records inside a handler's transaction. Every write declares the record's
 * resource (`<type>:<key>`) through `change`, so the runtime assigns its revision, journals it and
 * checks a caller's `expectedRevisions` for it; a write without a declaration cannot happen here.
 * Reads apply no policy: callers scope with their own visibility rule before counting or paging.
 */
export interface Records<T> {
  get(id: string): T | undefined;
  /** The record, or `NOT_FOUND` with `message`. */
  getExisting(id: string, message?: string): T;
  has(id: string): boolean;
  values(): T[];
  /** Add a new record; `CONFLICT` when the key exists. */
  insert(id: string, value: T, eventType?: string): T;
  /** Add or replace a record. */
  set(id: string, value: T, eventType?: string): T;
  /** Change an existing record in place, through a patch or a mutating function. */
  update(id: string, change: Partial<T> | ((record: T) => void), eventType?: string): T;
  /** Delete a record; `NOT_FOUND` when absent. */
  remove(id: string, eventType?: string): T;
  /** Declare a record changed without writing it, for a change derived from another record. */
  touch(id: string, eventType?: string): void;
  resource(id: string): string;
}

/**
 * Bind `collection` to the keyed object that holds its records in this handler's state. Queries
 * may use the read methods only; the runtime rejects a query that changes state.
 */
export function records<T, State, Services>(
  context: HandlerContext<State, Services>,
  collection: Pick<Collection, 'type' | 'label'>,
  store: Record<string, T>,
): Records<T> {
  const resource = (id: string) => `${collection.type}:${id}`;
  const missing = (message?: string) =>
    new ApplicationError('NOT_FOUND', message ?? `${collection.label.one} unavailable`);
  const touch = (id: string, eventType?: string) => context.change(resource(id), eventType);
  const existing = (id: string, message?: string) => {
    const record = own(store, id);
    if (record === undefined) throw missing(message);
    return record;
  };
  return {
    get: (id) => own(store, id),
    getExisting: existing,
    has: (id) => Object.hasOwn(store, id),
    values: () => Object.values(store),
    insert(id, value, eventType) {
      if (Object.hasOwn(store, id))
        throw new ApplicationError('CONFLICT', `${collection.label.one} exists`, { id });
      put(store, id, value);
      touch(id, eventType);
      return value;
    },
    set(id, value, eventType) {
      put(store, id, value);
      touch(id, eventType);
      return value;
    },
    update(id, change, eventType) {
      const record = existing(id);
      if (typeof change === 'function') change(record);
      else Object.assign(record as object, change);
      touch(id, eventType);
      return record;
    },
    remove(id, eventType) {
      const record = existing(id);
      delete store[id];
      touch(id, eventType);
      return record;
    },
    touch,
    resource,
  };
}

export interface CollectionReadOptions<State, Services, Stored, Item> {
  /** The keyed object holding the records in the module's state slice. */
  readonly store: (state: State) => Readonly<Record<string, Stored>>;
  /**
   * Whether the caller may see a record. Applied to every row before filters, counts and paging,
   * and by `get` before it answers, so a hidden record is indistinguishable from a missing one.
   */
  readonly visible: (record: Stored, context: HandlerContext<State, Services>) => boolean;
  /** What the caller sees of a stored record; the stored record itself when omitted. */
  readonly present?: (record: Stored, context: HandlerContext<State, Services>) => Item;
}

/** The default page size of a generated list. */
export const DEFAULT_PAGE = 50;

type ReadCapability = AnyCapability & { readonly kind: 'query' };
const presenter =
  <State, Services, Stored>(options: CollectionReadOptions<State, Services, Stored, unknown>) =>
  (record: Stored, context: HandlerContext<State, Services>) =>
    options.present ? options.present(record, context) : record;

/** The handler of a generated `<id>.get` (`collectionGet`). A hidden record is `NOT_FOUND`. */
export function collectionGetHandler<State, Services, C extends ReadCapability, Stored>(
  collection: Pick<Collection, 'label'>,
  capability: C,
  options: CollectionReadOptions<State, Services, Stored, OutputOf<C>>,
): HandlerContribution<State, Services, C> {
  const present = presenter(options);
  return {
    capability,
    handle(input, context) {
      const record = own(options.store(context.state), (input as { id: string }).id);
      if (record === undefined || !options.visible(record, context))
        throw new ApplicationError('NOT_FOUND', `${collection.label.one} unavailable`);
      return present(record, context) as OutputOf<C>;
    },
  };
}

/**
 * The handler of a generated `<id>.list` (`collectionList`). It scopes rows with `visible` first,
 * then applies the equality filters, counts, sorts and pages, so a row the caller may not see
 * never affects `total` or a page boundary. Policy still authorizes the operation itself.
 */
export function collectionListHandler<State, Services, C extends ReadCapability, Stored>(
  collection: Pick<Collection, 'key'>,
  capability: C,
  options: CollectionReadOptions<State, Services, Stored, RemoteItemOf<C>> & {
    /** List order; key order (code points) when omitted. */
    readonly order?: (a: Stored, b: Stored) => number;
    /** Text `search` matches, case-insensitively. Required when the list declares `search`. */
    readonly searchText?: (record: Stored) => string;
  },
): HandlerContribution<State, Services, C> {
  const present = presenter(options);
  const filters = listFilters(capability);
  if (listSearches(capability) !== !!options.searchText)
    throw new Error(`List search and searchText must be declared together: ${capability.id}`);
  const keyOf = (record: Stored) => String((record as Record<string, unknown>)[collection.key]);
  const order = options.order ?? ((a: Stored, b: Stored) => byCodePoint(keyOf(a), keyOf(b)));
  return {
    capability,
    handle(input, context) {
      const args = input as Record<string, unknown> & {
        search?: string;
        offset?: number;
        limit?: number;
      };
      const search = args.search?.toLowerCase();
      const rows = Object.values(options.store(context.state))
        // Scope first: nothing the caller may not see is filtered, counted or paged.
        .filter((record) => options.visible(record, context))
        .filter((record) =>
          filters.every(
            (field) =>
              args[field] === undefined ||
              (record as Record<string, unknown>)[field] === args[field],
          ),
        )
        .filter((record) => !search || options.searchText!(record).toLowerCase().includes(search))
        .sort(order);
      const offset = args.offset ?? 0;
      const page = rows.slice(offset, offset + (args.limit ?? DEFAULT_PAGE));
      const result: CollectionPage<unknown> = {
        items: page.map((record) => present(record, context)),
        total: rows.length,
      };
      return result as OutputOf<C>;
    },
  };
}

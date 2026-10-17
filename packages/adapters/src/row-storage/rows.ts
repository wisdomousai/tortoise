import type { WorkspaceSnapshot } from '@agent-native/runtime';

/** The row kinds one workspace is stored as; the journal has its own table. */
export type RowKind = 'state' | 'revision' | 'receipt' | 'effect' | 'blob';
/** Serialized rows by kind, then by key; values are JSON text. */
export type Rows = Map<RowKind, Map<string, string>>;

export const rowKinds: readonly RowKind[] = ['state', 'revision', 'receipt', 'effect', 'blob'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Split feature state into rows down to `depth` object levels: a module slice, a collection, a
 * record. An array, a scalar, an empty object or anything at `depth` is one row, keyed by its
 * JSON path. A commit then rewrites only the records it changed.
 */
function stateRows(state: unknown, depth: number, into: Map<string, string>, path: string[] = []) {
  if (isRecord(state) && path.length < depth && Object.keys(state).length > 0) {
    for (const [key, value] of Object.entries(state)) stateRows(value, depth, into, [...path, key]);
    return;
  }
  into.set(JSON.stringify(path), JSON.stringify(state));
}

/** The rows a snapshot is stored as, apart from its journal and counters. */
export function rowsOf<State>(snapshot: WorkspaceSnapshot<State>, depth: number): Rows {
  const rows: Rows = new Map(rowKinds.map((kind) => [kind, new Map()]));
  stateRows(snapshot.state, depth, rows.get('state')!);
  // A field a caller removed is stored as empty, as a document without it loads.
  const keyed = (kind: RowKind, record: Record<string, unknown> | undefined) => {
    for (const [key, value] of Object.entries(record ?? {}))
      rows.get(kind)!.set(key, JSON.stringify(value));
  };
  keyed('revision', snapshot.resourceRevisions);
  keyed('receipt', snapshot.receipts);
  keyed('effect', snapshot.effects);
  keyed('blob', snapshot.blobs);
  return rows;
}

/** Rebuild feature state from its rows, in stored order. Keys are own properties only. */
export function stateFrom(rows: ReadonlyMap<string, string>): unknown {
  let root: unknown = {};
  for (const [key, value] of rows) {
    const path = JSON.parse(key) as string[];
    const parsed: unknown = JSON.parse(value);
    if (path.length === 0) {
      root = parsed;
      continue;
    }
    let node = root as Record<string, unknown>;
    for (const segment of path.slice(0, -1)) {
      if (!Object.hasOwn(node, segment) || !isRecord(node[segment]))
        Object.defineProperty(node, segment, {
          value: {},
          enumerable: true,
          writable: true,
          configurable: true,
        });
      node = node[segment] as Record<string, unknown>;
    }
    Object.defineProperty(node, path.at(-1)!, {
      value: parsed,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return root;
}

/** Parse keyed rows into a null-prototype record, so a stored `__proto__` key stays data. */
export function recordFrom<T>(rows: ReadonlyMap<string, string> | undefined): Record<string, T> {
  const record: Record<string, T> = {};
  for (const [key, value] of rows ?? [])
    Object.defineProperty(record, key, {
      value: JSON.parse(value) as T,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return record;
}

/** What a commit writes: rows that are new or changed, and keys that are gone. */
export function rowChanges(before: Rows, after: Rows) {
  const upserts: [RowKind, string, string][] = [];
  const deletes: [RowKind, string][] = [];
  for (const kind of rowKinds) {
    const old = before.get(kind) ?? new Map<string, string>();
    const next = after.get(kind)!;
    for (const [key, value] of next) if (old.get(key) !== value) upserts.push([kind, key, value]);
    for (const key of old.keys()) if (!next.has(key)) deletes.push([kind, key]);
  }
  return { upserts, deletes };
}

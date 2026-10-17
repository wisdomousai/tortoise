import { assertJson } from '@agent-native/contracts';
import type {
  ChangeEvent,
  StateUpgrade,
  StateVersions,
  WorkspaceSnapshot,
} from '@agent-native/runtime';
import { recordFrom, rowKinds, stateFrom, type Rows } from './rows';
import type { SqlRowsDriver } from './schema';

/** A workspace as loaded: the snapshot, the rows it came from and its commit generation. */
export interface Loaded<State> {
  readonly snapshot: WorkspaceSnapshot<State>;
  readonly rows: Rows;
  readonly generation: number;
}
export interface Meta {
  readonly cursor: number;
  readonly authorization_revision: number;
  readonly journal_floor: number;
  readonly generation: number;
}

export const emptyRows = (): Rows => new Map(rowKinds.map((kind) => [kind, new Map()]));

/** The workspace's counters, or null before its first commit. */
export const readMeta = (driver: SqlRowsDriver, workspaceId: string) =>
  driver.get<Meta>(
    'SELECT cursor, authorization_revision, journal_floor, generation FROM workspace_meta WHERE workspace_id = ?',
    workspaceId,
  );

/**
 * Read every row of one workspace and rebuild its snapshot. A workspace that never committed
 * starts from a copy of the initial state, so a factory that returns one shared object never
 * sees a rolled-back transaction's mutations. `upgrade` maps a stored state on load.
 */
export function loadRows<State>(
  driver: SqlRowsDriver,
  workspaceId: string,
  meta: Meta | null,
  initialState: () => State,
  upgrade?: StateUpgrade<State>,
): Loaded<State> {
  const rows = emptyRows();
  for (const row of driver.all<{ kind: string; key: string; value: string }>(
    'SELECT kind, key, value FROM workspace_rows WHERE workspace_id = ? ORDER BY rowid',
    workspaceId,
  ))
    rows.get(row.kind as never)?.set(row.key, row.value);
  const journal = driver
    .all<{ value: string }>(
      'SELECT value FROM workspace_journal WHERE workspace_id = ? ORDER BY cursor',
      workspaceId,
    )
    .map((row) => row.value);
  return snapshotFrom(rows, journal, meta, initialState, upgrade);
}

/**
 * A snapshot from stored rows (in stored order), journal entries as JSON text in cursor order and
 * the counters; shared by every row-storage dialect.
 */
export function snapshotFrom<State>(
  rows: Rows,
  journalValues: readonly string[],
  meta: Meta | null,
  initialState: () => State,
  upgrade?: StateUpgrade<State>,
): Loaded<State> {
  const journal = journalValues.map((value) => JSON.parse(value) as ChangeEvent);
  const stored = meta ? (stateFrom(rows.get('state')!) as State) : structuredClone(initialState());
  const versions = rows.get('version')!.size
    ? (recordFrom(rows.get('version')) as StateVersions)
    : undefined;
  const upgraded = !upgrade
    ? { state: stored, versions }
    : meta
      ? upgrade.upgrade(stored, versions)
      : { state: stored, versions: upgrade.versions };
  const snapshot: WorkspaceSnapshot<State> = {
    state: upgraded.state,
    cursor: meta?.cursor ?? 0,
    authorizationRevision: meta?.authorization_revision ?? 0,
    resourceRevisions: recordFrom(rows.get('revision')),
    receipts: recordFrom(rows.get('receipt')),
    journal,
    effects: recordFrom(rows.get('effect')),
    blobs: recordFrom(rows.get('blob')),
    ...(meta?.journal_floor ? { journalFloor: meta.journal_floor } : {}),
    ...(upgraded.versions ? { stateVersions: upgraded.versions } : {}),
  };
  assertJson(snapshot);
  return { snapshot, rows, generation: meta?.generation ?? 0 };
}

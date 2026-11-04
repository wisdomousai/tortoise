import type { StateUpgrade, WorkspaceSnapshot } from '@tortoise/runtime';
import { emptyRows, snapshotFrom, type Loaded, type Meta } from '../row-storage/load';
import type { WriteStats } from '../row-storage/persist';
import { rowChanges, rowsOf, type RowKind, type Rows } from '../row-storage/rows';
import type { PgQuery, PgValue } from './driver';

/** Rows per multi-row statement; three or four parameters each, well under Postgres's limit. */
const BATCH = 500;

export async function readPgMeta(tx: PgQuery, key: string): Promise<Meta | null> {
  const [row] = await tx.query<Record<keyof Meta, string | number>>(
    'SELECT cursor, authorization_revision, journal_floor, generation FROM workspace_meta WHERE workspace_id = $1',
    [key],
  );
  if (!row) return null;
  return {
    cursor: Number(row.cursor),
    authorization_revision: Number(row.authorization_revision),
    journal_floor: Number(row.journal_floor),
    generation: Number(row.generation),
  };
}

/** Every row of one workspace, in the order it was first stored, rebuilt into a snapshot. */
export async function loadPgRows<State>(
  tx: PgQuery,
  key: string,
  meta: Meta | null,
  initialState: () => State,
  upgrade?: StateUpgrade<State>,
): Promise<Loaded<State>> {
  const rows = emptyRows();
  for (const row of await tx.query<{ kind: string; key: string; value: string }>(
    'SELECT kind, key, value FROM workspace_rows WHERE workspace_id = $1 ORDER BY seq',
    [key],
  ))
    rows.get(row.kind as never)?.set(row.key, row.value);
  const journal = await tx.query<{ value: string }>(
    'SELECT value FROM workspace_journal WHERE workspace_id = $1 ORDER BY cursor',
    [key],
  );
  return snapshotFrom(
    rows,
    journal.map((row) => row.value),
    meta,
    initialState,
    upgrade,
  );
}

/** Run `statement` with `$n` placeholders for each batch of rows, `width` values per row. */
async function batched(
  tx: PgQuery,
  items: readonly PgValue[][],
  width: number,
  statement: (values: string) => string,
) {
  for (let start = 0; start < items.length; start += BATCH) {
    const batch = items.slice(start, start + BATCH);
    const values = batch
      .map((_, row) => `(${Array.from({ length: width }, (_, i) => `$${row * width + i + 1}`)})`)
      .join(', ');
    await tx.query(statement(values), batch.flat());
  }
}

/**
 * Write what changed since `before` inside the caller's transaction, as `persistRows` does for
 * SQLite: counters with the next generation, changed and removed rows, appended journal entries,
 * and the journal up to its floor removed.
 */
export async function persistPgRows<State>(
  tx: PgQuery,
  key: string,
  snapshot: WorkspaceSnapshot<State>,
  before: { readonly rows: Rows; readonly generation: number; readonly journalMax: number },
  depth: number,
): Promise<{ readonly rows: Rows; readonly stats: WriteStats }> {
  const rows = rowsOf(snapshot, depth);
  const { upserts, deletes } = rowChanges(before.rows, rows);
  await tx.query(
    'INSERT INTO workspace_meta (workspace_id, cursor, authorization_revision, journal_floor, generation) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (workspace_id) DO UPDATE SET cursor = excluded.cursor, authorization_revision = excluded.authorization_revision, journal_floor = excluded.journal_floor, generation = excluded.generation',
    [
      key,
      snapshot.cursor,
      snapshot.authorizationRevision,
      snapshot.journalFloor ?? 0,
      before.generation + 1,
    ],
  );
  await batched(
    tx,
    upserts.map(([kind, rowKey, value]) => [key, kind, rowKey, value]),
    4,
    (values) =>
      `INSERT INTO workspace_rows (workspace_id, kind, key, value) VALUES ${values} ON CONFLICT (workspace_id, kind, key) DO UPDATE SET value = excluded.value`,
  );
  await batched(
    tx,
    deletes.map(([kind, rowKey]: [RowKind, string]) => [key, kind, rowKey]),
    3,
    (values) => `DELETE FROM workspace_rows WHERE (workspace_id, kind, key) IN (VALUES ${values})`,
  );
  // The kernel only appends to the journal, so entries past the loaded end are the new ones.
  const added = snapshot.journal.filter((entry) => entry.cursor > before.journalMax);
  await batched(
    tx,
    added.map((entry) => [key, entry.cursor, JSON.stringify(entry)]),
    3,
    (values) => `INSERT INTO workspace_journal (workspace_id, cursor, value) VALUES ${values}`,
  );
  if (snapshot.journalFloor)
    await tx.query('DELETE FROM workspace_journal WHERE workspace_id = $1 AND cursor <= $2', [
      key,
      snapshot.journalFloor,
    ]);
  return { rows, stats: { rows: upserts.length, deletes: deletes.length, journal: added.length } };
}

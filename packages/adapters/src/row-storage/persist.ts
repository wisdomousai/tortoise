import type { WorkspaceSnapshot } from '@agent-native/runtime';
import { rowChanges, rowsOf, type Rows } from './rows';
import type { SqlRowsDriver } from './schema';

/** What one commit wrote, for benchmarks and tests. */
export interface WriteStats {
  readonly rows: number;
  readonly deletes: number;
  readonly journal: number;
}

/**
 * Write what changed since `before` inside the caller's transaction: the counters with the next
 * generation, changed and removed rows, appended journal entries, and the removal of entries up
 * to the journal floor. Returns the rows now stored.
 */
export function persistRows<State>(
  driver: SqlRowsDriver,
  workspaceId: string,
  snapshot: WorkspaceSnapshot<State>,
  before: { readonly rows: Rows; readonly generation: number; readonly journalMax: number },
  depth: number,
): { readonly rows: Rows; readonly stats: WriteStats } {
  const rows = rowsOf(snapshot, depth);
  const { upserts, deletes } = rowChanges(before.rows, rows);
  driver.run(
    'INSERT INTO workspace_meta (workspace_id, cursor, authorization_revision, journal_floor, generation) VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET cursor = excluded.cursor, authorization_revision = excluded.authorization_revision, journal_floor = excluded.journal_floor, generation = excluded.generation',
    workspaceId,
    snapshot.cursor,
    snapshot.authorizationRevision,
    snapshot.journalFloor ?? 0,
    before.generation + 1,
  );
  for (const [kind, key, value] of upserts)
    driver.run(
      'INSERT INTO workspace_rows (workspace_id, kind, key, value) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, kind, key) DO UPDATE SET value = excluded.value',
      workspaceId,
      kind,
      key,
      value,
    );
  for (const [kind, key] of deletes)
    driver.run(
      'DELETE FROM workspace_rows WHERE workspace_id = ? AND kind = ? AND key = ?',
      workspaceId,
      kind,
      key,
    );
  // The kernel only appends to the journal, so entries past the loaded end are the new ones.
  const added = snapshot.journal.filter((entry) => entry.cursor > before.journalMax);
  for (const entry of added)
    driver.run(
      'INSERT INTO workspace_journal (workspace_id, cursor, value) VALUES (?, ?, ?)',
      workspaceId,
      entry.cursor,
      JSON.stringify(entry),
    );
  if (snapshot.journalFloor)
    driver.run(
      'DELETE FROM workspace_journal WHERE workspace_id = ? AND cursor <= ?',
      workspaceId,
      snapshot.journalFloor,
    );
  return { rows, stats: { rows: upserts.length, deletes: deletes.length, journal: added.length } };
}

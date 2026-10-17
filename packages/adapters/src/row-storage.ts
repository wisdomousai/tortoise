import { assertJson } from '@agent-native/contracts';
import type { StateUpgrade, Storage, WorkspaceSnapshot } from '@agent-native/runtime';
import { emptyRows, loadRows, readMeta, type Loaded } from './row-storage/load';
import { persistRows, type WriteStats } from './row-storage/persist';
import { openSchema, type SqlRowsDriver } from './row-storage/schema';

export { ROW_SCHEMA_VERSION, type SqlRowsDriver } from './row-storage/schema';
export type { WriteStats } from './row-storage/persist';

/** How much history a workspace keeps. Unset keeps everything. */
export interface Retention {
  /**
   * Journal entries to keep. Older ones are removed and `journalFloor` records the last removed
   * cursor; a subscriber behind it gets a reset and reloads, as after a revocation.
   */
  readonly journal?: number;
  /**
   * Idempotency receipts to keep, oldest removed first. A retry whose receipt was removed runs
   * again, so keep more than any caller retries across.
   */
  readonly receipts?: number;
}
export interface RowStorageOptions<State> {
  /** See `SnapshotStorage`: maps a state written by an earlier version on load. */
  readonly upgrade?: StateUpgrade<State>;
  /** Object levels of feature state stored as separate rows; 3 is slice, collection, record. */
  readonly depth?: number;
  readonly retention?: Retention;
}

/** Drop history past the retention limits before it is written. */
function retain<State>(snapshot: WorkspaceSnapshot<State>, retention: Retention = {}) {
  if (retention.journal !== undefined && snapshot.journal.length > retention.journal) {
    const removed = snapshot.journal.splice(0, snapshot.journal.length - retention.journal);
    snapshot.journalFloor = removed.at(-1)!.cursor;
  }
  const keys = Object.keys(snapshot.receipts);
  if (retention.receipts !== undefined && keys.length > retention.receipts)
    for (const key of keys.slice(0, keys.length - retention.receipts))
      delete snapshot.receipts[key];
}

/** A version 1 document as a complete snapshot; older documents lack the outbox and blobs. */
function fromDocument<State>(document: string): WorkspaceSnapshot<State> {
  const stored = JSON.parse(document) as Partial<WorkspaceSnapshot<State>>;
  return {
    ...stored,
    state: stored.state as State,
    cursor: stored.cursor ?? 0,
    authorizationRevision: stored.authorizationRevision ?? 0,
    resourceRevisions: stored.resourceRevisions ?? {},
    receipts: stored.receipts ?? {},
    journal: stored.journal ?? [],
    effects: stored.effects ?? {},
    blobs: stored.blobs ?? {},
  };
}

/**
 * Workspace persistence over a `SqlRowsDriver` with one row per record: feature state split to
 * `depth` object levels, and one row per resource revision, receipt, effect, blob reference and
 * journal entry. A commit diffs the snapshot against the rows it started from and writes only
 * what changed, inside one SQLite transaction, so it stays atomic. Reads and transactions run
 * one after another on the shared connection, like `SnapshotStorage`. A version 1 file (one JSON
 * document per workspace) is converted on open. Portable: the driver supplies the database.
 *
 * The last committed snapshot stays in memory with its generation. A transaction whose stored
 * generation still matches starts from it instead of reloading; another connection's commit
 * changes the generation, and a failed transaction drops the copy, so neither is ever reused.
 * Reads get a copy, so a reader's mutation never reaches the next caller.
 *
 * Gaps: the diff still serializes every row, so commit CPU grows with state size (as the
 * kernel's own state comparison does); bytes written follow the change. No encryption at rest.
 */
export class RowStorage<State> implements Storage<State> {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly depth: number;
  private readonly cache = new Map<string, Loaded<State>>();
  /** What the most recent commit wrote. */
  lastWrite: WriteStats = { rows: 0, deletes: 0, journal: 0 };
  constructor(
    private readonly driver: SqlRowsDriver,
    private readonly initialState: () => State,
    private readonly options: RowStorageOptions<State> = {},
  ) {
    this.depth = options.depth ?? 3;
    openSchema(driver, (workspaceId, document) => {
      const before = { rows: emptyRows(), generation: 0, journalMax: 0 };
      persistRows(driver, workspaceId, fromDocument<State>(document), before, this.depth);
    });
  }
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  /** The cached snapshot when it is still the stored one, else a fresh load. */
  private current(workspaceId: string): { loaded: Loaded<State>; cached: boolean } {
    const meta = readMeta(this.driver, workspaceId);
    const cached = this.cache.get(workspaceId);
    if (meta && cached?.generation === meta.generation) return { loaded: cached, cached: true };
    const { initialState, options } = this;
    return {
      loaded: loadRows(this.driver, workspaceId, meta, initialState, options.upgrade),
      cached: false,
    };
  }
  transact<T>(
    workspaceId: string,
    fn: (snapshot: WorkspaceSnapshot<State>) => Promise<T>,
  ): Promise<T> {
    return this.serialize(async () => {
      this.driver.exec('BEGIN IMMEDIATE');
      try {
        const { loaded } = this.current(workspaceId);
        const { snapshot } = loaded;
        const journalMax = snapshot.journal.at(-1)?.cursor ?? 0;
        const result = await fn(snapshot);
        assertJson(snapshot);
        // A removed record loads as empty from rows, so the cached copy must match it.
        snapshot.effects ??= {};
        snapshot.blobs ??= {};
        retain(snapshot, this.options.retention);
        const before = { ...loaded, journalMax };
        const { rows, stats } = persistRows(this.driver, workspaceId, snapshot, before, this.depth);
        this.driver.exec('COMMIT');
        this.cache.set(workspaceId, { snapshot, rows, generation: loaded.generation + 1 });
        this.lastWrite = stats;
        return result;
      } catch (error) {
        // The snapshot may hold the failed callback's mutations.
        this.cache.delete(workspaceId);
        this.driver.exec('ROLLBACK');
        throw error;
      }
    });
  }
  read<T>(
    workspaceId: string,
    fn: (snapshot: Readonly<WorkspaceSnapshot<State>>) => Promise<T>,
  ): Promise<T> {
    return this.serialize(async () => {
      this.driver.exec('BEGIN');
      try {
        const { loaded, cached } = this.current(workspaceId);
        const result = await fn(cached ? structuredClone(loaded.snapshot) : loaded.snapshot);
        this.driver.exec('COMMIT');
        return result;
      } catch (error) {
        this.driver.exec('ROLLBACK');
        throw error;
      }
    });
  }
  /**
   * Write a consistent copy of the whole database to `path` (which must not exist) while the
   * storage stays open, queued after the work already in flight. Verify it before relying on it.
   */
  backup(path: string): Promise<void> {
    return this.serialize(async () => this.driver.run('VACUUM INTO ?', path));
  }
  /** Every workspace that has committed in this database, in identifier order. */
  workspaces(): Promise<string[]> {
    return this.serialize(async () =>
      this.driver
        .all<{ workspace_id: string }>('SELECT workspace_id FROM workspace_meta ORDER BY 1')
        .map((row) => row.workspace_id),
    );
  }
  /** Close after every queued read and transaction has settled. */
  async close(): Promise<void> {
    await this.tail;
    this.driver.close();
  }
}

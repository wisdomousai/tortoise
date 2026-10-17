import { assertJson } from '@agent-native/contracts';
import type { StateUpgrade, Storage, WorkspaceSnapshot } from '@agent-native/runtime';
import type { SqlDriver } from './sql-driver';

/** A workspace that has never committed: no history, the initial state and empty records. */
function emptySnapshot<State>(state: State): WorkspaceSnapshot<State> {
  return {
    state,
    cursor: 0,
    authorizationRevision: 0,
    resourceRevisions: {},
    receipts: {},
    journal: [],
    effects: {},
    blobs: {},
  };
}

/**
 * Snapshot persistence over any `SqlDriver`: one JSON document per workspace in one table. All
 * reads and transactions on this storage run one after another, each inside a SQLite
 * transaction, so a callback's awaits never interleave with another's statements on the shared
 * connection. Portable: the driver supplies the database.
 */
export class SnapshotStorage<State> implements Storage<State> {
  private tail: Promise<unknown> = Promise.resolve();
  /**
   * `upgrade` maps a persisted feature state written by an earlier application version to the
   * current shape and stamps a new workspace (see `StateUpgrade`). It runs inside the same
   * read/transaction boundary on load; the upgraded state is persisted by the next commit. It
   * must be deterministic and must not drop data silently.
   */
  constructor(
    private readonly driver: SqlDriver,
    private readonly initialState: () => State,
    private readonly options: { readonly upgrade?: StateUpgrade<State> } = {},
  ) {
    driver.exec('BEGIN IMMEDIATE');
    try {
      driver.exec('CREATE TABLE IF NOT EXISTS framework_schema (version INTEGER NOT NULL);');
      const version = driver.get<{ version: number }>('SELECT version FROM framework_schema');
      if (version && version.version !== 1) throw new Error('Unsupported storage schema version');
      if (!version) driver.exec('INSERT INTO framework_schema VALUES (1)');
      driver.exec(
        'CREATE TABLE IF NOT EXISTS workspace_snapshots (workspace_id TEXT PRIMARY KEY, document TEXT NOT NULL)',
      );
      driver.exec('COMMIT');
    } catch (error) {
      driver.exec('ROLLBACK');
      throw error;
    }
  }
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  private snapshot(workspaceId: string): WorkspaceSnapshot<State> {
    const row = this.driver.get<{ document: string }>(
      'SELECT document FROM workspace_snapshots WHERE workspace_id = ?',
      workspaceId,
    );
    // A factory may hand out the same object every time; a rolled-back transaction must not
    // leave its mutations on it.
    const snapshot = row
      ? (JSON.parse(row.document) as WorkspaceSnapshot<State>)
      : emptySnapshot(structuredClone(this.initialState()));
    // Documents written before the transactional outbox or blob references existed load with
    // empty ones. The next commit persists the fields; the schema version stays compatible.
    if (!Object.hasOwn(snapshot, 'effects')) snapshot.effects = {};
    if (!Object.hasOwn(snapshot, 'blobs')) snapshot.blobs = {};
    const { upgrade } = this.options;
    if (row && upgrade) {
      const upgraded = upgrade.upgrade(snapshot.state, snapshot.stateVersions);
      snapshot.state = upgraded.state;
      snapshot.stateVersions = upgraded.versions;
    } else if (upgrade) snapshot.stateVersions = upgrade.versions;
    assertJson(snapshot);
    return snapshot;
  }
  transact<T>(
    workspaceId: string,
    fn: (snapshot: WorkspaceSnapshot<State>) => Promise<T>,
  ): Promise<T> {
    return this.serialize(async () => {
      this.driver.exec('BEGIN IMMEDIATE');
      try {
        const snapshot = this.snapshot(workspaceId);
        const result = await fn(snapshot);
        assertJson(snapshot);
        this.driver.run(
          'INSERT INTO workspace_snapshots (workspace_id, document) VALUES (?, ?) ON CONFLICT(workspace_id) DO UPDATE SET document = excluded.document',
          workspaceId,
          JSON.stringify(snapshot),
        );
        this.driver.exec('COMMIT');
        return result;
      } catch (error) {
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
        const result = await fn(this.snapshot(workspaceId));
        this.driver.exec('COMMIT');
        return result;
      } catch (error) {
        this.driver.exec('ROLLBACK');
        throw error;
      }
    });
  }
  /** Close after every queued read and transaction has settled. */
  async close(): Promise<void> {
    await this.tail;
    this.driver.close();
  }
}

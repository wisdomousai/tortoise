import { Database } from 'bun:sqlite';
import { assertJson } from '@agent-native/contracts';
import type { Storage, WorkspaceSnapshot } from '../../runtime/src/index';

/** Reference snapshot persistence. Features can replace this with transaction-bound repositories. */
export class SQLiteStorage<State> implements Storage<State> {
  private readonly db: Database;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    path: string,
    private readonly initialState: () => State,
  ) {
    this.db = new Database(path, { create: true });
    this.db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;',
    );
    this.db
      .transaction(() => {
        this.db.exec('CREATE TABLE IF NOT EXISTS framework_schema (version INTEGER NOT NULL);');
        const version = this.db.query('SELECT version FROM framework_schema').get() as {
          version: number;
        } | null;
        if (version && version.version !== 1) throw new Error('Unsupported storage schema version');
        if (!version) this.db.exec('INSERT INTO framework_schema VALUES (1)');
        this.db.exec(
          'CREATE TABLE IF NOT EXISTS workspace_snapshots (workspace_id TEXT PRIMARY KEY, document TEXT NOT NULL)',
        );
      })
      .immediate();
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
    const row = this.db
      .query('SELECT document FROM workspace_snapshots WHERE workspace_id = ?')
      .get(workspaceId) as { document: string } | null;
    const snapshot: WorkspaceSnapshot<State> = row
      ? JSON.parse(row.document)
      : {
          state: this.initialState(),
          cursor: 0,
          authorizationRevision: 0,
          resourceRevisions: {},
          receipts: {},
          journal: [],
        };
    assertJson(snapshot);
    return snapshot;
  }
  transact<T>(
    workspaceId: string,
    fn: (snapshot: WorkspaceSnapshot<State>) => Promise<T>,
  ): Promise<T> {
    return this.serialize(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const snapshot = this.snapshot(workspaceId);
        const result = await fn(snapshot);
        assertJson(snapshot);
        const document = JSON.stringify(snapshot);
        this.db
          .query(
            'INSERT INTO workspace_snapshots (workspace_id, document) VALUES (?, ?) ON CONFLICT(workspace_id) DO UPDATE SET document = excluded.document',
          )
          .run(workspaceId, document);
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    });
  }
  read<T>(
    workspaceId: string,
    fn: (snapshot: Readonly<WorkspaceSnapshot<State>>) => Promise<T>,
  ): Promise<T> {
    return this.serialize(async () => {
      this.db.exec('BEGIN');
      try {
        const result = await fn(this.snapshot(workspaceId));
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    });
  }
  async close(): Promise<void> {
    await this.tail;
    this.db.close(true);
  }
}

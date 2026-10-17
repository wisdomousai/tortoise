import { assertJson } from '@agent-native/contracts';
import type { Storage, WorkspaceSnapshot } from '@agent-native/runtime';
import { lockKey, type PgDriver, type PgQuery } from './postgres/driver';
import { loadPgRows, persistPgRows, readPgMeta } from './postgres/rows';
import { openPgSchema } from './postgres/schema';
import { retain, type RowStorageOptions, type WriteStats } from './row-storage';
import type { Loaded } from './row-storage/load';

export { PG_SCHEMA_VERSION } from './postgres/schema';
export type { PgDriver, PgQuery, PgValue } from './postgres/driver';

export interface PostgresStorageOptions<State> extends RowStorageOptions<State> {
  /**
   * Stored workspace keys are `<scope>/<workspaceId>`, so several deployments share one database
   * without seeing each other's rows. Unset: the workspace ID alone.
   */
  readonly scope?: string;
  /**
   * Run inside every commit after the workspace lock and before anything is read: a workspace
   * lease's `check`, which throws when this writer no longer holds the workspace.
   */
  readonly fence?: (tx: PgQuery) => Promise<void>;
}

/**
 * Workspace persistence on Postgres in the row layout of the SQLite storage: one row per record,
 * one per resource revision, receipt, effect, blob reference and journal entry, and a commit
 * writes only what changed, in one transaction.
 *
 * Several hosts may share the database. A commit takes a transaction-scoped advisory lock on its
 * workspace key first, so commits to one workspace run one after another across connections,
 * then runs the fence, then reads the counters: the generation it sees is the latest committed.
 * The last committed snapshot stays cached with its generation, as in `RowStorage`. Reads run in
 * a repeatable-read transaction, so they see one commit, and get a copy of the cached snapshot.
 *
 * `close` waits for queued work and leaves the driver open: the lease and other storages may
 * share it, and its owner closes it.
 */
export class PostgresStorage<State> implements Storage<State> {
  private tail: Promise<unknown> = Promise.resolve();
  private schema: Promise<void> | undefined;
  private readonly depth: number;
  private readonly cache = new Map<string, Loaded<State>>();
  /** What the most recent commit wrote. */
  lastWrite: WriteStats = { rows: 0, deletes: 0, journal: 0 };
  constructor(
    private readonly driver: PgDriver,
    private readonly initialState: () => State,
    private readonly options: PostgresStorageOptions<State> = {},
  ) {
    this.depth = options.depth ?? 3;
  }
  private key(workspaceId: string) {
    return this.options.scope ? `${this.options.scope}/${workspaceId}` : workspaceId;
  }
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      this.schema ??= openPgSchema(this.driver).catch((error: unknown) => {
        this.schema = undefined;
        throw error;
      });
      await this.schema;
      return fn();
    };
    const next = this.tail.then(run, run);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  private async current(tx: PgQuery, key: string) {
    const meta = await readPgMeta(tx, key);
    const cached = this.cache.get(key);
    if (meta && cached?.generation === meta.generation) return { loaded: cached, cached: true };
    const { initialState, options } = this;
    return {
      loaded: await loadPgRows(tx, key, meta, initialState, options.upgrade),
      cached: false,
    };
  }
  transact<T>(
    workspaceId: string,
    fn: (snapshot: WorkspaceSnapshot<State>) => Promise<T>,
  ): Promise<T> {
    const key = this.key(workspaceId);
    return this.serialize(async () => {
      try {
        const committed = await this.driver.transaction(async (tx) => {
          await lockKey(tx, `agent-native:workspace:${key}`);
          await this.options.fence?.(tx);
          const { loaded } = await this.current(tx, key);
          const { snapshot } = loaded;
          const journalMax = snapshot.journal.at(-1)?.cursor ?? 0;
          const result = await fn(snapshot);
          assertJson(snapshot);
          // A removed record loads as empty from rows, so the cached copy must match it.
          snapshot.effects ??= {};
          snapshot.blobs ??= {};
          retain(snapshot, this.options.retention);
          const before = { ...loaded, journalMax };
          const written = await persistPgRows(tx, key, snapshot, before, this.depth);
          return { result, snapshot, generation: loaded.generation + 1, ...written };
        });
        // Cached only once the commit is acknowledged.
        const { snapshot, rows, generation } = committed;
        this.cache.set(key, { snapshot, rows, generation });
        this.lastWrite = committed.stats;
        return committed.result;
      } catch (error) {
        // The snapshot may hold the failed callback's mutations.
        this.cache.delete(key);
        throw error;
      }
    });
  }
  read<T>(
    workspaceId: string,
    fn: (snapshot: Readonly<WorkspaceSnapshot<State>>) => Promise<T>,
  ): Promise<T> {
    const key = this.key(workspaceId);
    return this.serialize(() =>
      this.driver.transaction(async (tx) => {
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        const { loaded, cached } = await this.current(tx, key);
        return fn(cached ? structuredClone(loaded.snapshot) : loaded.snapshot);
      }),
    );
  }
  /** Every workspace in this scope that has committed, in identifier order. */
  workspaces(): Promise<string[]> {
    const prefix = this.options.scope ? `${this.options.scope}/` : '';
    return this.serialize(() =>
      this.driver.transaction(async (tx) =>
        (
          await tx.query<{ workspace_id: string }>(
            'SELECT workspace_id FROM workspace_meta WHERE starts_with(workspace_id, $1) ORDER BY 1',
            [prefix],
          )
        ).map((row) => row.workspace_id.slice(prefix.length)),
      ),
    );
  }
  /** Settle every queued read and transaction. The driver stays open. */
  async close(): Promise<void> {
    await this.tail;
  }
}

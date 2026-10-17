/** A value SQLite binds or returns. */
export type SqlValue = string | number | null | Uint8Array;

/**
 * The synchronous SQLite calls the snapshot storage and the exclusive lock need, so the same code
 * runs on `bun:sqlite` and on `expo-sqlite`'s synchronous API. One driver is one connection, used
 * by one caller at a time. Statements are plain SQLite; drivers add no dialect.
 */
export interface SqlDriver {
  /** Run one or more statements without results. Throws on any SQLite error, such as SQLITE_BUSY. */
  exec(sql: string): void;
  /** The first row, or null. */
  get<Row>(sql: string, ...params: SqlValue[]): Row | null;
  /** Run one statement with bound parameters. */
  run(sql: string, ...params: SqlValue[]): void;
  close(): void;
}

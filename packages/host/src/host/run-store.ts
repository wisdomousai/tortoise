import { Database } from 'bun:sqlite';
import type { RunSnapshot, RunStore } from '@agent-native/agents/types';

/** Run snapshots are separate from business transactions; a completed run is never a commit receipt. */
export class SQLiteRunStore implements RunStore {
  private db: Database;
  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL)',
    );
  }
  async get(id: string) {
    const row = this.db.query('SELECT snapshot FROM runs WHERE id=?').get(id) as {
      snapshot: string;
    } | null;
    return row ? (JSON.parse(row.snapshot) as RunSnapshot) : undefined;
  }
  async list() {
    return (
      this.db.query('SELECT snapshot FROM runs ORDER BY rowid').all() as { snapshot: string }[]
    ).map((row) => JSON.parse(row.snapshot) as RunSnapshot);
  }
  async save(snapshot: RunSnapshot) {
    this.db
      .query(
        'INSERT INTO runs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot',
      )
      .run(snapshot.id, JSON.stringify(snapshot));
  }
  close() {
    this.db.close();
  }
}

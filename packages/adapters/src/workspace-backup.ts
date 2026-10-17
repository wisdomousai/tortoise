import { Database } from 'bun:sqlite';
import { copyFile, rename, rm } from 'node:fs/promises';
import { ROW_SCHEMA_VERSION } from './row-storage';

/** What a verified backup holds. */
export interface BackupSummary {
  readonly schemaVersion: number;
  readonly workspaces: number;
}

/**
 * Check a backup before trusting it: SQLite's integrity check passes, the schema version is one
 * this build reads, and every workspace has its counters. Opens the file read-only; throws with a
 * reason otherwise.
 */
export function verifyBackup(path: string): BackupSummary {
  const db = new Database(path, { readonly: true });
  try {
    const integrity = db.query('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity.integrity_check !== 'ok')
      throw new Error('The backup failed its integrity check');
    const schema = db.query('SELECT version FROM framework_schema').get() as {
      version: number;
    } | null;
    if (schema?.version !== ROW_SCHEMA_VERSION)
      throw new Error('The backup has an unsupported storage schema version');
    const { count } = db.query('SELECT count(*) AS count FROM workspace_meta').get() as {
      count: number;
    };
    return { schemaVersion: schema.version, workspaces: count };
  } finally {
    db.close();
  }
}

/**
 * Replace the database at `target` with a verified backup. The caller must own the workspace
 * (no host running on it). The copy lands next to the target and is renamed over it; the old
 * write-ahead log is removed first, so none of its pages are replayed onto the restored file. A
 * crash before the rename leaves the old file without its log; running the restore again
 * completes it.
 */
export async function restoreBackup(backup: string, target: string): Promise<BackupSummary> {
  const summary = verifyBackup(backup);
  const staged = `${target}.restore`;
  await copyFile(backup, staged);
  await rm(`${target}-wal`, { force: true });
  await rm(`${target}-shm`, { force: true });
  await rename(staged, target);
  return summary;
}

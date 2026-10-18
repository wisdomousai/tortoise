import type { SqlDriver } from './sql-driver';

export class WorkspaceOwnedError extends Error {
  constructor(readonly canonicalPath: string) {
    super('Workspace already has a live instance');
    this.name = 'WorkspaceOwnedError';
  }
}

/** Lock keys this JavaScript runtime holds; a second holder here is refused before SQLite is asked. */
const heldHere = new Set<string>();

/**
 * Exclusive ownership of `canonicalPath` through a live `EXCLUSIVE` transaction on a lock
 * database that `open` connects to. The database releases it when the connection closes or the
 * process dies, so no stale file ever grants or blocks ownership. A second acquisition in the
 * same runtime (a background task while the screens are open) is refused as well as one from
 * another process. Throws `WorkspaceOwnedError` while another holder is live.
 */
export function acquireExclusiveLock(open: () => SqlDriver, canonicalPath: string) {
  if (heldHere.has(canonicalPath)) throw new WorkspaceOwnedError(canonicalPath);
  const driver = open();
  try {
    driver.exec('PRAGMA busy_timeout = 0; PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE;');
  } catch {
    driver.close();
    throw new WorkspaceOwnedError(canonicalPath);
  }
  heldHere.add(canonicalPath);
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      heldHere.delete(canonicalPath);
      try {
        driver.exec('ROLLBACK');
      } finally {
        driver.close();
      }
    },
  };
}

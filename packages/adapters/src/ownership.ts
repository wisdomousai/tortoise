import { Database } from 'bun:sqlite';
import { mkdir, realpath, writeFile, rename, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceOwnedError } from './exclusive-lock';

export { WorkspaceOwnedError };
export type AuthorityMetadata = { instance: string; endpoint: string; workspacePath: string };

/** A live SQLite EXCLUSIVE transaction is an OS-held lock; PID files never grant ownership. */
export async function acquireWorkspaceOwnership(path: string) {
  await mkdir(path, { recursive: true });
  const canonicalPath = await realpath(path);
  const db = new Database(join(canonicalPath, '.authority-lock.sqlite'), { create: true });
  try {
    db.exec('PRAGMA busy_timeout = 0; PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE;');
  } catch {
    db.close();
    throw new WorkspaceOwnedError(canonicalPath);
  }
  const instance = randomUUID();
  const metadataPath = join(canonicalPath, '.authority.json');
  let released = false;
  return {
    canonicalPath,
    instance,
    async publish(endpoint: string): Promise<void> {
      if (released) throw new Error('Ownership was released');
      const metadata: AuthorityMetadata = { instance, endpoint, workspacePath: canonicalPath };
      const temporary = `${metadataPath}.${instance}.tmp`;
      await writeFile(temporary, JSON.stringify(metadata), { mode: 0o600 });
      await rename(temporary, metadataPath);
    },
    async release(): Promise<void> {
      if (released) return;
      released = true;
      try {
        const current = JSON.parse(await readFile(metadataPath, 'utf8')) as AuthorityMetadata;
        if (current.instance === instance) await unlink(metadataPath);
      } catch {
        /* Crash metadata may be absent; the OS lock remains authoritative. */
      }
      db.exec('ROLLBACK');
      db.close(true);
    },
  };
}

/** Endpoint hints are untrusted until the caller authenticates the authority instance. */
export async function readAuthorityMetadata(path: string): Promise<AuthorityMetadata | undefined> {
  try {
    return JSON.parse(
      await readFile(join(await realpath(path), '.authority.json'), 'utf8'),
    ) as AuthorityMetadata;
  } catch {
    return undefined;
  }
}

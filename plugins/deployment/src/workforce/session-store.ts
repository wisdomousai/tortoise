import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { ApplicationError } from '@tortoise/contracts';
import { LOCAL_WORKSPACE } from '@tortoise/kernel/instance';
import type { ExecutionContext } from '@tortoise/runtime';

const digestOf = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Workforce sessions in `workforce-sessions.sqlite` in the workspace directory, so a restart keeps
 * people signed in until their sessions expire. Only the SHA-256 of each token is stored, so
 * reading the file gives no usable cookie. The context a session resolves to carries a signal
 * that aborts when the person signs out, so a request still running under it stops.
 */
export class WorkforceSessions {
  private db: Database;
  private ended = new Map<string, AbortController>();
  constructor(
    path: string,
    private readonly now: () => number,
  ) {
    this.db = new Database(path, { create: true });
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, principal TEXT NOT NULL, expires INTEGER NOT NULL)',
    );
  }
  /** Drop expired sessions; true while fewer than `limit` remain. */
  room(limit: number): boolean {
    this.db.query('DELETE FROM sessions WHERE expires <= ?').run(this.now());
    const { count } = this.db.query('SELECT count(*) AS count FROM sessions').get() as {
      count: number;
    };
    return count < limit;
  }
  create(token: string, principalId: string, expires: number) {
    this.db.query('INSERT INTO sessions VALUES (?,?,?)').run(digestOf(token), principalId, expires);
  }
  get(token: string): ExecutionContext | undefined {
    const digest = digestOf(token);
    const row = this.db
      .query('SELECT principal, expires FROM sessions WHERE digest=?')
      .get(digest) as { principal: string; expires: number } | null;
    if (!row || row.expires <= this.now()) {
      if (row) this.end(digest);
      return undefined;
    }
    let controller = this.ended.get(digest);
    if (!controller) this.ended.set(digest, (controller = new AbortController()));
    return { workspaceId: LOCAL_WORKSPACE, principalId: row.principal, signal: controller.signal };
  }
  revoke(token: string) {
    this.end(digestOf(token));
  }
  close() {
    this.db.close();
  }
  private end(digest: string) {
    this.db.query('DELETE FROM sessions WHERE digest=?').run(digest);
    this.ended.get(digest)?.abort(new ApplicationError('CANCELLED', 'Signed out'));
    this.ended.delete(digest);
  }
}

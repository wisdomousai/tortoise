import { randomBytes } from 'node:crypto';
import type { ExecutionContext } from '@agent-native/runtime';

export interface HostSession {
  token: string;
  context: ExecutionContext;
  expiresAt: number;
}

/** Trusted hosts mint credentials. Request bodies never select principals or roles. */
export class Sessions {
  private sessions = new Map<string, HostSession>();
  private launches = new Map<string, { session: HostSession; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  create(context: ExecutionContext, ttl = 86_400_000): HostSession {
    const session = {
      token: randomBytes(32).toString('base64url'),
      context,
      expiresAt: this.now() + ttl,
    };
    this.sessions.set(session.token, session);
    return session;
  }
  launch(session: HostSession): string {
    const key = randomBytes(32).toString('base64url');
    this.launches.set(key, { session, expiresAt: this.now() + 60_000 });
    return key;
  }
  exchange(key: string): HostSession | undefined {
    const launch = this.launches.get(key);
    this.launches.delete(key);
    return launch && launch.expiresAt > this.now() ? this.get(launch.session.token) : undefined;
  }
  get(token: string): HostSession | undefined {
    const session = this.sessions.get(token);
    if (session && session.expiresAt > this.now()) return session;
    this.sessions.delete(token);
    return undefined;
  }
  revoke(token: string): void {
    this.sessions.delete(token);
  }
}

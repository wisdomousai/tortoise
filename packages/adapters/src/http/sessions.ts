import { randomBytes } from 'node:crypto';
import type { ExecutionContext } from '@agent-native/runtime';

export interface HostSession {
  token: string;
  context: ExecutionContext;
  expiresAt: number;
  /**
   * Set when the session stands for a bearer credential the host does not store, such as a paired
   * device's. Every request rechecks it, so revoking the credential ends the session.
   */
  credential?: string;
}

/** Trusted hosts mint credentials. Request bodies never select principals or roles. */
export class Sessions {
  private sessions = new Map<string, HostSession>();
  private launches = new Map<string, { session: HostSession; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  create(context: ExecutionContext, ttl = 86_400_000, credential?: string): HostSession {
    const session: HostSession = {
      token: randomBytes(32).toString('base64url'),
      context,
      expiresAt: this.now() + ttl,
      ...(credential === undefined ? {} : { credential }),
    };
    this.sessions.set(session.token, session);
    return session;
  }
  launch(session: HostSession): string {
    const key = randomBytes(32).toString('base64url');
    this.launches.set(key, { session, expiresAt: this.now() + 60_000 });
    return key;
  }
  /**
   * The session a launch key opens. A key minted from a credential session opens a browser session
   * of its own that still names the credential, so the cookie never carries the credential itself.
   */
  exchange(key: string): HostSession | undefined {
    const launch = this.launches.get(key);
    this.launches.delete(key);
    if (!launch || launch.expiresAt <= this.now()) return undefined;
    const { session } = launch;
    return session.credential === undefined
      ? this.get(session.token)
      : this.create(session.context, undefined, session.credential);
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

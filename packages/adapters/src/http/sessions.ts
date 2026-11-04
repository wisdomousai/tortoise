import { randomBytes } from 'node:crypto';
import { ApplicationError } from '@tortoise/contracts';
import type { ExecutionContext } from '@tortoise/runtime';

export interface HostSession {
  token: string;
  context: ExecutionContext;
  expiresAt: number;
  /**
   * Set when the session stands for a bearer credential the host does not store, such as a paired
   * device's. Every request rechecks it, so revoking the credential ends the session.
   */
  credential?: string;
  /** Where `credential` was presented; it is rechecked the same way. Absent means a bearer. */
  via?: CredentialSource;
}

/** Where a request carried a credential: the Authorization header or the session cookie. */
export type CredentialSource = 'bearer' | 'cookie';

/** Resolves a credential the host does not store; see `HttpHandlerOptions.authenticateToken`. */
export type TokenAuthenticator = (
  token: string,
  via: CredentialSource,
  /** The request that carried the token, for a credential that also signs the request. */
  request?: Request,
) => Promise<HostSession | undefined>;

/** Trusted hosts issue credentials. Request bodies never select principals or roles. */
export class Sessions {
  private sessions = new Map<string, HostSession>();
  private ended = new Map<string, AbortController>();
  private launches = new Map<string, { session: HostSession; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  create(
    context: ExecutionContext,
    ttl = 86_400_000,
    credential?: string,
    via?: CredentialSource,
  ): HostSession {
    const session: HostSession = {
      token: randomBytes(32).toString('base64url'),
      context,
      expiresAt: this.now() + ttl,
      ...(credential === undefined ? {} : { credential }),
      ...(via === undefined ? {} : { via }),
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
   * The session a launch key opens. A key issued to a credential session opens a browser session
   * of its own that still names the credential, so the cookie never carries the credential itself.
   */
  exchange(key: string): HostSession | undefined {
    const launch = this.launches.get(key);
    this.launches.delete(key);
    if (!launch || launch.expiresAt <= this.now()) return undefined;
    const { session } = launch;
    return session.credential === undefined
      ? this.get(session.token)
      : this.create(session.context, undefined, session.credential, session.via);
  }
  get(token: string): HostSession | undefined {
    const session = this.sessions.get(token);
    if (session && session.expiresAt > this.now()) return session;
    this.end(token, 'Session expired');
    return undefined;
  }
  /**
   * Aborts when the session is revoked or expires, so a request still running under it stops at
   * the runtime's next check instead of committing.
   */
  signal(token: string): AbortSignal {
    let controller = this.ended.get(token);
    if (!controller) {
      controller = new AbortController();
      if (this.sessions.has(token)) this.ended.set(token, controller);
      else controller.abort(new ApplicationError('CANCELLED', 'Session ended'));
    }
    const remaining = (this.sessions.get(token)?.expiresAt ?? 0) - this.now();
    // A timer holds at most 2^31 - 1 ms; a longer session is caught by `get` on its next request.
    return remaining > 0 && remaining < 2 ** 31
      ? AbortSignal.any([controller.signal, AbortSignal.timeout(remaining)])
      : controller.signal;
  }
  revoke(token: string): void {
    this.end(token, 'Session revoked');
  }
  private end(token: string, reason: string) {
    this.sessions.delete(token);
    this.ended.get(token)?.abort(new ApplicationError('CANCELLED', reason));
    this.ended.delete(token);
  }
}

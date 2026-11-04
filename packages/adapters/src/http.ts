import { ApplicationError, errorEnvelope, type Catalog } from '@tortoise/contracts';
import type {
  CommandReceipt,
  ExecutionContext,
  Invocation,
  QueryResult,
  EventBatch,
} from '@tortoise/runtime';
import { withSignal, type ApplicationPort } from './application-port';
import { Cursors } from './http/cursors';
import { jsonResponse, statusCodes } from './http/response';
import { exchangeLaunch, routeAuthenticated } from './http/routes';
import { readSessionCookie } from './http/session-cookie';
import type { HostSession, Sessions, TokenAuthenticator } from './http/sessions';

export { withSignal, type ApplicationPort } from './application-port';
export { readJsonBody } from './http/body';
export { jsonResponse } from './http/response';
export { readSessionCookie, sessionCookie, sessionCookieName } from './http/session-cookie';
export {
  Sessions,
  type CredentialSource,
  type HostSession,
  type TokenAuthenticator,
} from './http/sessions';

export interface HttpHandlerOptions {
  application: ApplicationPort;
  sessions: Sessions;
  origin: () => string;
  pollMs?: number;
  publicRoute?: (request: Request) => Promise<Response | undefined>;
  /**
   * A credential that is not a host session: a bearer token such as a paired device's, or a
   * session cookie a plugin set, such as a signed-in person's. `via` says which, and the
   * resolver must accept each only from its own source. Asked on every such request, so
   * revocation applies at the next one.
   */
  authenticateToken?: TokenAuthenticator;
  extra?: (request: Request, session: HostSession) => Promise<Response | undefined>;
  static?: (path: string) => Promise<Response | undefined>;
}

/**
 * A stored session with its credential's current context, or undefined once the credential is
 * refused, which also ends the stored session.
 */
async function current(options: HttpHandlerOptions, session: HostSession, request: Request) {
  if (session.credential === undefined) return session;
  const resolved = await options.authenticateToken?.(
    session.credential,
    session.via ?? 'bearer',
    request,
  );
  if (resolved) return { ...session, context: resolved.context };
  options.sessions.revoke(session.token);
  return undefined;
}

/**
 * The session a request presents. Browser writes without a bearer must be same-origin. A stored
 * session wins; otherwise a bearer is offered to `authenticateToken` as a bearer, and a cookie,
 * when there is no bearer, as a cookie. A refusal carries `details.credential`, so a client can
 * tell a missing or revoked credential from a denied operation, which is also FORBIDDEN.
 */
async function authenticate(
  options: HttpHandlerOptions,
  request: Request,
  requestOrigin: string | null,
  origin: string,
): Promise<HostSession> {
  const bearer = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
  const cookie = readSessionCookie(request, origin);
  if (!bearer && request.method !== 'GET' && requestOrigin !== origin)
    throw new ApplicationError('FORBIDDEN', 'Browser writes require same-origin validation');
  const stored = options.sessions.get(bearer ?? cookie ?? '');
  const session = stored
    ? await current(options, stored, request)
    : bearer
      ? await options.authenticateToken?.(bearer, 'bearer', request)
      : cookie
        ? await options.authenticateToken?.(cookie, 'cookie', request)
        : undefined;
  if (!session)
    throw new ApplicationError('FORBIDDEN', 'Local session required', { credential: 'rejected' });
  return session;
}

/** Host, public-route, origin and cross-site checks, then routes in order of trust needed. */
async function handle(options: HttpHandlerOptions, cursors: Cursors, request: Request) {
  const url = new URL(request.url);
  const origin = options.origin();
  if (url.origin !== origin || request.headers.get('host') !== new URL(origin).host)
    return jsonResponse({ error: { code: 'FORBIDDEN', message: 'Untrusted host' } }, 403);
  // OAuth top-level callbacks are cross-site requests. The sole public callback owns its
  // state/nonce/session checks and still passes the instance Host check above.
  const publicResponse = await options.publicRoute?.(request);
  if (publicResponse) return publicResponse;
  const requestOrigin = request.headers.get('origin');
  if (requestOrigin && requestOrigin !== origin)
    return jsonResponse({ error: { code: 'FORBIDDEN', message: 'Untrusted origin' } }, 403);
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    throw new ApplicationError('FORBIDDEN', 'Cross-site requests are forbidden');
  if (url.pathname === '/health' && request.method === 'GET')
    return jsonResponse({ status: 'ready' });
  if (url.pathname === '/api/v1/session' && request.method === 'POST')
    return exchangeLaunch(options.sessions, request);
  if (!url.pathname.startsWith('/api/'))
    return (await options.static?.(url.pathname)) ?? new Response('Not found', { status: 404 });
  const session = await authenticate(options, request, requestOrigin, origin);
  // The request stops when the client goes away, when the host revokes or expires its stored
  // session, or when the credential's own signal aborts (a plugin sets one on the context it
  // resolves). The runtime rechecks the signal after every await, so the command does not commit.
  const ended = options.sessions.get(session.token)
    ? options.sessions.signal(session.token)
    : undefined;
  const context = withSignal(
    withSignal({ ...session.context, channel: 'http' }, request.signal),
    ended,
  );
  return (
    (await routeAuthenticated({ ...options, cursors }, request, session, context)) ??
    (await options.extra?.(request, session)) ??
    jsonResponse({ error: { code: 'NOT_FOUND', message: 'Unknown route' } }, 404)
  );
}

/**
 * Loopback adapter with Host/Origin checks, one-use launch key exchange and bounded pull-based SSE.
 * Cursor/event authorization is evaluated immediately before enqueue. Each enqueue is one batch;
 * slow readers are disconnected instead of accumulating sensitive snapshots in a host queue.
 */
export function createHttpHandler(options: HttpHandlerOptions) {
  const cursors = new Cursors();
  return async (request: Request): Promise<Response> => {
    try {
      return await handle(options, cursors, request);
    } catch (error) {
      const envelope = errorEnvelope(error);
      return jsonResponse({ error: envelope }, statusCodes[envelope.code]);
    }
  };
}

import { ApplicationError, errorEnvelope, type Catalog } from '@agent-native/contracts';
import type {
  CommandReceipt,
  ExecutionContext,
  Invocation,
  QueryResult,
  EventBatch,
} from '@agent-native/runtime';
import { withSignal, type ApplicationPort } from './application-port';
import { Cursors } from './http/cursors';
import { jsonResponse, statusCodes } from './http/response';
import { exchangeLaunch, routeAuthenticated } from './http/routes';
import type { HostSession, Sessions } from './http/sessions';

export { withSignal, type ApplicationPort } from './application-port';
export { readJsonBody } from './http/body';
export { jsonResponse } from './http/response';
export { Sessions, type HostSession } from './http/sessions';

export interface HttpHandlerOptions {
  application: ApplicationPort;
  sessions: Sessions;
  origin: () => string;
  pollMs?: number;
  publicRoute?: (request: Request) => Promise<Response | undefined>;
  extra?: (request: Request, session: HostSession) => Promise<Response | undefined>;
  static?: (path: string) => Promise<Response | undefined>;
}

/** The session a request presents. Browser writes without a bearer must be same-origin. */
function authenticate(
  options: HttpHandlerOptions,
  request: Request,
  requestOrigin: string | null,
  origin: string,
): HostSession {
  const bearer = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
  const cookie = request.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)agent_session=([A-Za-z0-9_-]+)/)?.[1];
  if (!bearer && request.method !== 'GET' && requestOrigin !== origin)
    throw new ApplicationError('FORBIDDEN', 'Browser writes require same-origin validation');
  const session = options.sessions.get(bearer ?? cookie ?? '');
  if (!session) throw new ApplicationError('FORBIDDEN', 'Local session required');
  return session;
}

/** Host, public-route, origin and cross-site checks, then routes in order of trust needed. */
async function handle(options: HttpHandlerOptions, cursors: Cursors, request: Request) {
  const url = new URL(request.url);
  const origin = options.origin();
  if (url.origin !== origin || request.headers.get('host') !== new URL(origin).host)
    return jsonResponse({ error: { code: 'FORBIDDEN', message: 'Untrusted host' } }, 403);
  // OAuth top-level callbacks arrive cross-site. The sole public callback owns its
  // state/nonce/session checks and still passes the authority Host check above.
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
  const session = authenticate(options, request, requestOrigin, origin);
  const context = withSignal({ ...session.context, channel: 'http' }, request.signal);
  return (
    (await routeAuthenticated({ ...options, cursors }, request, session, context)) ??
    (await options.extra?.(request, session)) ??
    jsonResponse({ error: { code: 'NOT_FOUND', message: 'Unknown route' } }, 404)
  );
}

/**
 * Loopback adapter with Host/Origin checks, one-use launch exchange and bounded pull-based SSE.
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

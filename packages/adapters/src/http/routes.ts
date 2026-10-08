import { ApplicationError } from '@agent-native/contracts';
import type { ExecutionContext, Invocation } from '@agent-native/runtime';
import type { ApplicationPort } from '../http';
import { parseRevisions, readJsonBody } from './body';
import type { Cursors } from './cursors';
import { eventStreamResponse } from './event-stream';
import { jsonResponse } from './response';
import type { HostSession, Sessions } from './sessions';

export interface AuthenticatedRoutes {
  readonly application: ApplicationPort;
  readonly sessions: Sessions;
  readonly cursors: Cursors;
  readonly pollMs?: number;
}

/** POST /api/v1/session: exchange a one-use launch key for the session cookie. */
export async function exchangeLaunch(sessions: Sessions, request: Request) {
  const body = await readJsonBody(request);
  const session = sessions.exchange(typeof body.launch === 'string' ? body.launch : '');
  if (!session)
    throw new ApplicationError('FORBIDDEN', 'Launch credential expired or already used');
  return jsonResponse({ connected: true }, 200, {
    'Set-Cookie': `agent_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
  });
}

/** POST /api/v1/{commands|queries}/:operation. Commands require an idempotency key. */
async function invoke(
  routes: AuthenticatedRoutes,
  request: Request,
  session: HostSession,
  context: ExecutionContext,
  kind: string,
  operation: string,
) {
  const body = await readJsonBody(request);
  const invocation: Invocation = {
    operation,
    input: body.input,
    ...(typeof body.idempotencyKey === 'string' ? { idempotencyKey: body.idempotencyKey } : {}),
    ...(body.expectedRevisions === undefined
      ? {}
      : { expectedRevisions: parseRevisions(body.expectedRevisions) }),
  };
  if (kind === 'commands' && !invocation.idempotencyKey)
    throw new ApplicationError('INVALID_INPUT', 'Commands require an idempotency key');
  const result =
    kind === 'commands'
      ? await routes.application.invokeRaw(invocation, context)
      : await routes.application.queryRaw(invocation, context);
  return jsonResponse({
    ...result,
    cursor: routes.cursors.encode(result.cursor, result.authorizationRevision, session.token),
  });
}

/** The framework's own authenticated routes; undefined hands the request to host routes. */
export async function routeAuthenticated(
  routes: AuthenticatedRoutes,
  request: Request,
  session: HostSession,
  context: ExecutionContext,
): Promise<Response | undefined> {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/v1/launch' && request.method === 'POST')
    return jsonResponse({ launch: routes.sessions.launch(session) });
  if (pathname === '/api/v1/contract' && request.method === 'GET')
    return jsonResponse(routes.application.discover(context));
  if (pathname === '/api/v1/events' && request.method === 'GET')
    return eventStreamResponse(routes, request, session, context);
  const match = pathname.match(/^\/api\/v1\/(commands|queries)\/([^/]+)$/);
  if (match && request.method === 'POST')
    return invoke(routes, request, session, context, match[1]!, decodeURIComponent(match[2]!));
  return undefined;
}

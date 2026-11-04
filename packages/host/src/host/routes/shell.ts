import {
  ApplicationError,
  type OsActionRequest,
  type OsPlatform,
  type RawOsRequest,
} from '@tortoise/contracts';
import { jsonResponse, type HostSession } from '@tortoise/adapters/http';
import { readBytes } from '@tortoise/adapters/http/body';
import type { HostRoute, HostRouteContext } from './types';

/** A text payload may be 1 MiB; JSON escaping can triple it. */
const requestLimit = 4 * 1_048_576;

async function readObject(request: Request, limit: number): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new ApplicationError('INVALID_INPUT', 'JSON content type required');
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(await readBytes(request, limit)));
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
  }
  throw new ApplicationError('INVALID_INPUT', 'JSON object required');
}

/**
 * A request an adapter received from the OS. The shell port validates and matches it; an
 * accepted request is queued for this session's frame, never for another session, and the
 * response says only what happened, so a sender learns nothing it did not send.
 */
async function receive(request: Request, session: HostSession, host: HostRouteContext) {
  const body = await readObject(request, requestLimit);
  const outcome = await host.shell.receive(
    session.context,
    body.request as RawOsRequest,
    body.platform as OsPlatform,
  );
  if (outcome.status !== 'delivered') return jsonResponse(outcome);
  await host.uiDeliveries.send(session, outcome.delivery);
  return jsonResponse({ status: outcome.status, handler: outcome.handler });
}

async function relayNext(request: Request, url: URL, session: HostSession, host: HostRouteContext) {
  const next = await host.shellRelay.next(
    session,
    url.searchParams.get('platform') ?? '',
    request.signal,
  );
  return next ? jsonResponse(next) : new Response(null, { status: 204 });
}

async function relayResult(
  request: Request,
  session: HostSession,
  id: string,
  host: HostRouteContext,
) {
  const body = await readObject(request, 65_536);
  if (typeof body.ok !== 'boolean')
    throw new ApplicationError('INVALID_INPUT', 'Invalid OS action result');
  host.shellRelay.respond(session, id, {
    ok: body.ok,
    ...(typeof body.detail === 'string' ? { detail: body.detail.slice(0, 200) } : {}),
  });
  return jsonResponse({ received: true });
}

/**
 * The shell API: adapters submit OS requests, callers ask for declared OS actions, an adapter in
 * another process polls for the actions it should perform and posts their results, and the declarations
 * are readable so an adapter can check URLs it is about to open. Without a plugin that provides
 * the shell port these return UNAVAILABLE.
 */
export const shellRoute: HostRoute = async (request, url, session, host) => {
  const match = url.pathname.match(
    /^\/api\/v1\/shell\/(requests|actions|declarations)(?:\/([^/]+)\/result)?$/,
  );
  if (!match) return undefined;
  const [, area, id] = match;
  if (area === 'requests' && !id && request.method === 'POST')
    return receive(request, session, host);
  if (area === 'actions' && !id && request.method === 'POST') {
    const body = await readObject(request, 65_536);
    return jsonResponse(
      await host.shell.perform(session.context, body as unknown as OsActionRequest),
    );
  }
  if (area === 'actions' && !id && request.method === 'GET')
    return relayNext(request, url, session, host);
  if (area === 'actions' && id && request.method === 'POST')
    return relayResult(request, session, id, host);
  if (area === 'declarations' && !id && request.method === 'GET')
    return jsonResponse(host.application.catalog.os ?? { handlers: [], actions: [] });
  return undefined;
};

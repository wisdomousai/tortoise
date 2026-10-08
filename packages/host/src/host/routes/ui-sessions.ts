import { ApplicationError } from '@agent-native/contracts';
import { jsonResponse, readJsonBody, type HostSession } from '@agent-native/adapters/http';
import type { UiContextInput } from '@agent-native/adapters/ui-sessions';
import type { UiIntent } from '@agent-native/react';
import type { HostRoute, HostRouteContext } from './types';

/**
 * Candidate validation may await multiple reads. Fence the entire batch against local policy
 * changes and enqueue under the authority's serialized read boundary.
 */
async function pollIntents(
  request: Request,
  session: HostSession,
  id: string,
  host: HostRouteContext,
) {
  const before = await host.application.events(0, session.context);
  const candidates = await host.uiSessions.poll(session, id);
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          await host.application.deliverEvents(0, session.context, (batch) => {
            const current =
              !!host.sessions.get(session.token) &&
              !request.signal.aborted &&
              before.authorizationRevision === batch.authorizationRevision;
            controller.enqueue(new TextEncoder().encode(JSON.stringify(current ? candidates : [])));
            controller.close();
          });
        } catch {
          controller.enqueue(new TextEncoder().encode('[]'));
          controller.close();
        }
      },
    }),
    { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
}

async function acknowledge(
  request: Request,
  session: HostSession,
  id: string,
  host: HostRouteContext,
) {
  const body = await readJsonBody(request);
  if (typeof body.id !== 'string' || !['accepted', 'rejected'].includes(String(body.status)))
    throw new ApplicationError('INVALID_INPUT', 'Invalid intent acknowledgement');
  host.uiSessions.acknowledge(session, id, body.id, body.status as 'accepted' | 'rejected');
  return jsonResponse({ acknowledged: true });
}

/** Register and update UI sessions, poll and send their intents, and acknowledge them. */
export const uiSessionRoute: HostRoute = async (request, url, session, host) => {
  if (url.pathname === '/api/v1/ui/sessions' && request.method === 'POST')
    return jsonResponse(
      await host.uiSessions.register(
        session,
        (await readJsonBody(request)) as unknown as UiContextInput,
      ),
    );
  const uiRoute = url.pathname.match(/^\/api\/v1\/ui\/sessions\/([^/]+)(?:\/(intents|ack))?$/);
  if (!uiRoute) return undefined;
  const id = uiRoute[1]!;
  if (!uiRoute[2] && request.method === 'POST') {
    const body = await readJsonBody(request);
    return jsonResponse(
      await host.uiSessions.update(
        session,
        id,
        body.context as UiContextInput,
        typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined,
      ),
    );
  }
  if (uiRoute[2] === 'intents' && request.method === 'GET')
    return pollIntents(request, session, id, host);
  if (uiRoute[2] === 'intents' && request.method === 'POST')
    return jsonResponse({
      id: await host.uiSessions.send(
        session,
        id,
        (await readJsonBody(request)) as unknown as UiIntent,
      ),
    });
  if (uiRoute[2] === 'ack' && request.method === 'POST')
    return acknowledge(request, session, id, host);
  return undefined;
};

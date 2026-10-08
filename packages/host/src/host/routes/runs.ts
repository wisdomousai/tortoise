import { ApplicationError } from '@agent-native/contracts';
import { jsonResponse, readJsonBody, type HostSession } from '@agent-native/adapters/http';
import { ownsRun, visibleRun } from '../run-access';
import type { HostRoute, HostRouteContext } from './types';

type StartBody = { prompt: string; harnessId: string } & Record<string, unknown>;

/** Runs are started by an active user delegation; a run cannot start another run. */
function assertMayStartRun(session: HostSession) {
  const { context } = session;
  if (
    context.runId ||
    context.grant?.runId ||
    context.signal?.aborted ||
    (context.grant?.expiresAt !== undefined && context.grant.expiresAt <= Date.now())
  )
    throw new ApplicationError(
      'FORBIDDEN',
      'An active user delegation is required; nested run delegation is not supported',
    );
}

async function readStartBody(request: Request): Promise<StartBody> {
  const body = await readJsonBody(request);
  if (
    !body ||
    typeof body !== 'object' ||
    !('prompt' in body) ||
    typeof body.prompt !== 'string' ||
    !('harnessId' in body) ||
    typeof body.harnessId !== 'string'
  )
    throw new ApplicationError('INVALID_INPUT', 'Run requires harnessId and prompt');
  if (body.prompt.length > 32_000)
    throw new ApplicationError('INVALID_INPUT', 'Run prompt exceeds limit');
  return body as StartBody;
}

/**
 * The run's context, captured now from the authenticated session (never from the prompt): its
 * authorization revision, provider selection, grant and the UI selection it was started from.
 */
async function runContext(session: HostSession, body: StartBody, host: HostRouteContext) {
  const captured =
    typeof body.uiSessionId === 'string'
      ? await host.uiSessions.capture(session, body.uiSessionId)
      : undefined;
  if (captured && body.uiContextVersion !== undefined && captured.version !== body.uiContextVersion)
    throw new ApplicationError('CONFLICT', 'UI selection changed before the run started');
  const authorizationRevision = (await host.application.events(0, session.context))
    .authorizationRevision;
  const selection =
    body.harnessId === 'deterministic' ||
    host.harnesses?.some((harness) => harness.id === body.harnessId)
      ? {}
      : host.providers.resolveSelection(session, {
          harnessId: body.harnessId,
          ...(typeof body.profileId === 'string' ? { profileId: body.profileId } : {}),
          ...(typeof body.model === 'string' ? { model: body.model } : {}),
        });
  return {
    principalId: session.context.principalId,
    workspaceId: session.context.workspaceId,
    authorizationRevision,
    ...selection,
    ...(session.context.grant ? { grant: structuredClone(session.context.grant) } : {}),
    ...(captured ? { uiContext: captured } : {}),
  };
}

async function startRun(request: Request, session: HostSession, host: HostRouteContext) {
  assertMayStartRun(session);
  const body = await readStartBody(request);
  const context = await runContext(session, body, host);
  return jsonResponse(
    await host.supervisor.start({ harnessId: body.harnessId, prompt: body.prompt, context }),
    202,
  );
}

async function ownRun(id: string, session: HostSession, host: HostRouteContext) {
  const run = await host.supervisor.get(id);
  if (!run || !ownsRun(run, session)) throw new ApplicationError('NOT_FOUND', 'Run unavailable');
  return run;
}

/** Answer a pending question or approval, only under the authorization the run started with. */
async function respond(request: Request, id: string, session: HostSession, host: HostRouteContext) {
  const run = await ownRun(id, session, host);
  if (
    run.context.authorizationRevision !==
    (await host.application.events(0, session.context)).authorizationRevision
  )
    throw new ApplicationError('FORBIDDEN', 'Permissions changed; start a new run');
  const body = await readJsonBody(request);
  if (typeof body.requestId !== 'string')
    throw new ApplicationError('INVALID_INPUT', 'Pending request ID required');
  if (body.type === 'question' && typeof body.answer === 'string' && body.answer.length <= 8_000)
    await host.supervisor.respondQuestion(run.id, body.requestId, body.answer);
  else if (body.type === 'approval' && typeof body.approved === 'boolean')
    await host.supervisor.respondApproval(run.id, body.requestId, body.approved);
  else throw new ApplicationError('INVALID_INPUT', 'Invalid question or approval response');
  return jsonResponse({ accepted: true });
}

/** List, start, cancel and answer the session's own agent runs. */
export const runRoute: HostRoute = async (request, url, session, host) => {
  if (url.pathname === '/api/v1/runs' && request.method === 'GET')
    return jsonResponse(
      await Promise.all(
        (await host.supervisor.list())
          .filter((run) => ownsRun(run, session))
          .map((run) => visibleRun(host.application, run, session.context)),
      ),
    );
  if (url.pathname === '/api/v1/runs' && request.method === 'POST')
    return startRun(request, session, host);
  const cancel = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)\/cancel$/);
  if (cancel && request.method === 'POST') {
    const run = await ownRun(cancel[1]!, session, host);
    await host.supervisor.cancel(run.id);
    return jsonResponse(
      await visibleRun(host.application, (await host.supervisor.get(run.id))!, session.context),
    );
  }
  const answer = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)\/respond$/);
  if (answer && request.method === 'POST') return respond(request, answer[1]!, session, host);
  return undefined;
};

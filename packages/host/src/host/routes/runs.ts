import { randomUUID } from 'node:crypto';
import { agentInstructions, ApplicationError } from '@agent-native/contracts';
import { agentGrant } from '@agent-native/runtime';
import { jsonResponse, readJsonBody, type HostSession } from '@agent-native/adapters/http';
import { chooseHarness } from '@agent-native/agents/placement';
import { ownsRun, visibleRun } from '../run-access';
import type { HostRoute, HostRouteContext } from './types';

/**
 * `harnessId` names the harness; with `agentId` it may be left out, and the host picks the first
 * harness it was given that meets the agent's model requirement. `conversationId` continues a
 * conversation of the caller's own runs.
 */
type StartBody = {
  prompt: string;
  harnessId?: string;
  agentId?: string;
  conversationId?: string;
} & Record<string, unknown>;

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
    typeof body.prompt !== 'string' ||
    (body.harnessId !== undefined && typeof body.harnessId !== 'string') ||
    (body.agentId !== undefined && typeof body.agentId !== 'string') ||
    (body.conversationId !== undefined && typeof body.conversationId !== 'string') ||
    (body.harnessId === undefined && body.agentId === undefined)
  )
    throw new ApplicationError('INVALID_INPUT', 'Run requires a prompt and harnessId or agentId');
  if (body.prompt.length > 32_000)
    throw new ApplicationError('INVALID_INPUT', 'Run prompt exceeds limit');
  return body as StartBody;
}

/**
 * The run's context, captured now from the authenticated session (never from the prompt): its
 * authorization revision, provider selection, grant and the UI selection it was started from.
 */
async function runContext(
  session: HostSession,
  body: StartBody & { harnessId: string },
  host: HostRouteContext,
  agent?: { id: string; runId: string },
) {
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
  // A run under an agent definition acts under the session's grant narrowed by `agentGrant`,
  // scoped to the selection it started on; `grant` stays the session's, which owns the run.
  const delegation = agent
    ? agentGrant(host.application.catalog, agent.id, session.context, {
        runId: agent.runId,
        now: Date.now(),
        ...(captured ? { resources: captured.selectedResources } : {}),
      })
    : undefined;
  return {
    principalId: session.context.principalId,
    workspaceId: session.context.workspaceId,
    authorizationRevision,
    ...selection,
    ...(session.context.grant ? { grant: structuredClone(session.context.grant) } : {}),
    ...(captured ? { uiContext: captured } : {}),
    ...(agent ? { agentId: agent.id, delegation } : {}),
  };
}

/** A conversation continues only from the caller's own runs, under the same agent. */
async function checkConversation(
  session: HostSession,
  host: HostRouteContext,
  conversationId: string,
  agentId: string | undefined,
) {
  const runs = (await host.supervisor.list()).filter(
    (run) => run.conversationId === conversationId,
  );
  if (!runs.length || !runs.every((run) => ownsRun(run, session)))
    throw new ApplicationError('NOT_FOUND', 'Conversation unavailable');
  if (runs.some((run) => run.context.agentId !== agentId))
    throw new ApplicationError('CONFLICT', 'The conversation runs under another agent');
}

/** The named harness, or the first host harness that meets the agent's model requirement. */
async function harnessFor(body: StartBody, host: HostRouteContext, agentId?: string) {
  if (body.harnessId) return body.harnessId;
  const agent = host.application.catalog.agents.find((candidate) => candidate.id === agentId)!;
  const harness = await chooseHarness(agent.model, host.harnesses ?? [], {
    agent: agent.id,
    ...(agent.models ? { models: agent.models } : {}),
  });
  return harness.id;
}

async function startRun(request: Request, session: HostSession, host: HostRouteContext) {
  assertMayStartRun(session);
  const body = await readStartBody(request);
  const agent = body.agentId
    ? host.application.catalog.agents.find((candidate) => candidate.id === body.agentId)
    : undefined;
  if (body.agentId && !agent) throw new ApplicationError('NOT_FOUND', 'Unknown agent');
  if (body.conversationId !== undefined)
    await checkConversation(session, host, body.conversationId, agent?.id);
  const harnessId = await harnessFor(body, host, agent?.id);
  const id = randomUUID();
  const context = await runContext(
    session,
    { ...body, harnessId },
    host,
    agent ? { id: agent.id, runId: id } : undefined,
  );
  // A model reads the definition's instructions first; the deterministic harness reads a script.
  const prompt =
    agent && harnessId !== 'deterministic'
      ? `${agentInstructions(host.application.catalog, agent.id)}\n\n${body.prompt}`
      : body.prompt;
  return jsonResponse(
    await host.supervisor.start({
      id,
      harnessId,
      prompt,
      context,
      ...(body.conversationId ? { conversationId: body.conversationId } : {}),
      ...(agent
        ? {
            budget: { ...agent.budgets },
            model: agent.model,
            demand: { agent: agent.id, ...(agent.models ? { models: agent.models } : {}) },
          }
        : {}),
    }),
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

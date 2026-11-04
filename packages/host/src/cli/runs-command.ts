import { PENDING_EXIT_CODE, readConnection, takeFlag } from '@tortoise/adapters/cli';
import { ApplicationError, type ErrorEnvelope } from '@tortoise/contracts';
import type { RunSnapshot } from '@tortoise/agents/types';
import { terminalStates } from '@tortoise/agents/types';
import { rejectRemaining, report } from './args';

export const runsUsage = (
  program: string,
) => `Agent runs (against a live instance, as its connection's session):
  ${program} runs start --agent id [--harness id] [--conversation id] [--wait] <request>
      start a run of the agent definition; --wait prints the run once it ends or asks, and exits
      ${PENDING_EXIT_CODE} while it waits for an answer
  ${program} runs list [--conversation id]        the session's runs, oldest first
  ${program} runs show <run>                      one run with its events
  ${program} runs answer <run> <answer> | --approve | --decline   answer its open question or approval
  ${program} runs cancel <run>
`;

/** The run route of the instance the connection file names, as that connection's session. */
async function runRoute(connection: string | undefined) {
  const file = await readConnection(connection).catch((error: Error) => {
    throw new ApplicationError('INVALID_INPUT', error.message);
  });
  return async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(new URL(`/api/v1/runs${path}`, file.endpoint), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${file.token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = (await response.json().catch(() => ({}))) as T & { error?: ErrorEnvelope };
    if (!response.ok)
      throw new ApplicationError(
        value.error?.code ?? 'UNAVAILABLE',
        value.error?.message ?? `Run route answered ${response.status}`,
      );
    return value;
  };
}
type Route = Awaited<ReturnType<typeof runRoute>>;

/** The question or approval the run waits for, if it waits for one. */
const openOf = (run: RunSnapshot) =>
  run.state.startsWith('awaiting-')
    ? run.events.findLast((event) => event.type === 'question' || event.type === 'approval')
    : undefined;

/**
 * Poll the run until it ends or asks, then print it; a run that asks exits with the pending code.
 * The request `answered` names no longer counts as asking, since the run reads it only after.
 */
async function waitFor(route: Route, id: string, answered?: string) {
  for (;;) {
    const run = await route<RunSnapshot>(`/${id}`);
    const open = openOf(run);
    const asking = open !== undefined && open.requestId !== answered;
    if (terminalStates.has(run.state) || asking) {
      report(run);
      return asking ? PENDING_EXIT_CODE : run.state === 'succeeded' ? 0 : 1;
    }
    await Bun.sleep(500);
  }
}

/** The run's open question or approval, which an answer names. */
async function openRequest(route: Route, id: string) {
  const request = openOf(await route<RunSnapshot>(`/${id}`));
  if (!request?.requestId)
    throw new ApplicationError('CONFLICT', `Run ${id} has no open question or approval`);
  return request;
}

const runId = (args: string[]) => {
  const id = args.shift();
  if (!id) throw new ApplicationError('INVALID_INPUT', 'Name the run');
  return id;
};

/**
 * `runs start|list|show|answer|cancel`. Runs execute in the instance that holds the supervisor, so
 * every verb attaches through the connection file (`--connection` or `TORTOISE_CONNECTION`); the
 * session it names owns the runs, as a person's browser session owns theirs.
 */
export async function runsCommand(args: string[]) {
  const route = await runRoute(takeFlag(args, 'connection'));
  const verb = args.shift();
  if (verb === 'start') {
    const agentId = takeFlag(args, 'agent');
    const harnessId = takeFlag(args, 'harness');
    const conversationId = takeFlag(args, 'conversation');
    const wait = takeFlag(args, 'wait', false) !== undefined;
    const prompt = args.splice(0).join(' ');
    if (!agentId && !harnessId)
      throw new ApplicationError('INVALID_INPUT', 'runs start needs --agent or --harness');
    if (!prompt) throw new ApplicationError('INVALID_INPUT', 'runs start needs a request');
    const run = await route<RunSnapshot>('', {
      prompt,
      ...(agentId ? { agentId } : {}),
      ...(harnessId ? { harnessId } : {}),
      ...(conversationId ? { conversationId } : {}),
    });
    if (wait) return waitFor(route, run.id);
    report(run);
    return 0;
  }
  if (verb === 'list') {
    const conversationId = takeFlag(args, 'conversation');
    rejectRemaining(args);
    const runs = await route<RunSnapshot[]>('');
    for (const run of runs)
      if (!conversationId || run.conversationId === conversationId)
        report({
          id: run.id,
          state: run.state,
          conversationId: run.conversationId,
          agentId: run.context.agentId,
          createdAt: run.createdAt,
          ...(run.request !== undefined ? { request: run.request } : {}),
        });
    return 0;
  }
  if (verb === 'show') {
    const id = runId(args);
    rejectRemaining(args);
    report(await route<RunSnapshot>(`/${id}`));
    return 0;
  }
  if (verb === 'answer') {
    const id = runId(args);
    const approve = takeFlag(args, 'approve', false) !== undefined;
    const decline = takeFlag(args, 'decline', false) !== undefined;
    const answer = args.splice(0).join(' ');
    const request = await openRequest(route, id);
    const response =
      request.type === 'approval'
        ? approve !== decline
          ? { approved: approve }
          : undefined
        : answer
          ? { answer }
          : undefined;
    if (!response)
      throw new ApplicationError(
        'INVALID_INPUT',
        request.type === 'approval' ? 'Pass --approve or --decline' : 'Write the answer',
      );
    await route(`/${id}/respond`, {
      requestId: request.requestId,
      type: request.type,
      ...response,
    });
    return waitFor(route, id, request.requestId);
  }
  if (verb === 'cancel') {
    const id = runId(args);
    rejectRemaining(args);
    report(await route<RunSnapshot>(`/${id}/cancel`, {}));
    return 0;
  }
  throw new ApplicationError('INVALID_INPUT', 'runs takes start, list, show, answer or cancel');
}

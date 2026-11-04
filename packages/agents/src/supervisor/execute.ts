import { randomUUID } from 'node:crypto';
import type { ConversationTurn, Harness, ToolPort } from '../types';
import { terminalStates } from '../types';
import { earlierTurns } from './conversation';
import {
  abortCheck,
  emit,
  emitText,
  flushText,
  observe,
  request,
  setState,
  type Active,
  type SupervisorKernel,
} from './run';

/** What a settled call left for its `tool-finish` event: changed records or a refusal code. */
type Outcome = { resources?: string[]; code?: string };
type Calls = Map<string, { fingerprint: string; result: Promise<unknown> }>;

/** The records a command result names in its revisions, or the code of a refusal. */
function outcomeOf(settled: PromiseSettledResult<unknown>): Outcome {
  if (settled.status === 'rejected') {
    const code = (settled.reason as { code?: unknown } | undefined)?.code;
    return typeof code === 'string' ? { code } : { code: 'FAILED' };
  }
  const revisions = (settled.value as { revisions?: unknown } | undefined)?.revisions;
  return revisions && typeof revisions === 'object' && !Array.isArray(revisions)
    ? { resources: Object.keys(revisions).slice(0, 20) }
    : {};
}

/** Stop the run because a budget ran out: abort its work and release a waiting request. */
function exceed(run: Active, budget: string) {
  run.budgetExceeded ??= budget;
  run.controller.abort(new Error(`Run ${budget} budget exhausted`));
  run.pending?.reject(new Error(`Run ${budget} budget exhausted`));
}

/**
 * The application's tools as this run sees them: refused once the run is aborted or terminal,
 * and idempotent per invocation ID, which is reused only with the same arguments.
 */
function runTools(kernel: SupervisorKernel, run: Active, calls: Calls): ToolPort {
  const tools = kernel.options.tools;
  return {
    definitions: tools.definitionsFor?.(run.snapshot.context) ?? tools.definitions,
    execute(operation, input, context) {
      abortCheck(run);
      if (terminalStates.has(run.snapshot.state)) throw new Error('Run is already terminal');
      const id = context.idempotencyKey ?? randomUUID();
      const fingerprint = JSON.stringify([operation, input]);
      let call = calls.get(id);
      if (call && call.fingerprint !== fingerprint)
        throw new Error('Tool invocation ID reused with different arguments');
      if (!call) {
        // A repeated invocation ID is the same call, so only new calls count against the budget.
        const limit = run.snapshot.budget?.toolCalls;
        if (limit !== undefined && calls.size >= limit) {
          exceed(run, 'tool call');
          throw new Error('Run tool call budget exhausted');
        }
        const result = tools.execute(operation, input, {
          runId: run.snapshot.id,
          signal: run.controller.signal,
          idempotencyKey: `${run.snapshot.id}:${id}`,
        });
        call = { fingerprint, result };
        calls.set(id, call);
      }
      return call.result;
    },
  };
}

/** Run one harness turn and record its events in the provider's order. */
async function streamTurn(
  kernel: SupervisorKernel,
  run: Active,
  harness: Harness,
  prompt: string,
  calls: Calls,
  earlier: readonly ConversationTurn[],
) {
  for await (const event of harness.run({
    runId: run.snapshot.id,
    conversationId: run.snapshot.conversationId,
    prompt,
    context: Object.freeze(structuredClone(run.snapshot.context)),
    signal: run.controller.signal,
    resumeData: run.snapshot.resumeData,
    ...(earlier.length ? { earlier } : {}),
    ...(run.snapshot.budget ? { budget: structuredClone(run.snapshot.budget) } : {}),
    tools: runTools(kernel, run, calls),
    question: async (message, choices) =>
      String(await request(kernel, run, 'question', message, choices)),
    approve: async (message) => Boolean(await request(kernel, run, 'approval', message)),
  })) {
    abortCheck(run);
    if (event.type === 'text') {
      await emitText(kernel, run, event.text);
      continue;
    }
    // Held text precedes any later event, so event order matches the provider's.
    await flushText(kernel, run);
    if (event.type === 'resume-data') {
      run.snapshot.resumeData = structuredClone(event.data);
      await emit(kernel, run, { type: 'progress', message: 'Native session recorded' });
    } else if (event.type === 'tool-finish') {
      // The call's own result, settled before its finish is recorded; the harness has it too.
      const call = calls.get(event.callId);
      const outcome = call ? outcomeOf((await Promise.allSettled([call.result]))[0]!) : {};
      await emit(kernel, run, {
        ...event,
        ...(outcome.resources?.length ? { resources: outcome.resources } : {}),
        ...(outcome.code ? { code: outcome.code } : {}),
      });
    } else await emit(kernel, run, event);
  }
  await flushText(kernel, run);
}

/** Cancelled when aborted, otherwise failed with a scrubbed, bounded message. */
async function completeFailure(kernel: SupervisorKernel, run: Active, error: unknown) {
  if (terminalStates.has(run.snapshot.state)) return;
  // Partial output before a failure is kept, scrubbed like every other event.
  if (!run.persistenceFailed) await flushText(kernel, run).catch(() => {});
  if (run.budgetExceeded) {
    run.snapshot.failure = {
      code: 'BUDGET_EXCEEDED',
      message: `The run used its ${run.budgetExceeded} budget`,
    };
    await setState(kernel, run, 'failed');
  } else if (run.controller.signal.aborted) await setState(kernel, run, 'cancelled');
  else {
    run.snapshot.failure = {
      code: 'HARNESS_FAILED',
      message: kernel.redactor
        .scrub(error instanceof Error ? error.message : String(error))
        .slice(0, 2000),
    };
    run.controller.abort(new Error('Harness failed'));
    await setState(kernel, run, 'failed');
  }
}

/** Execute a queued run to a terminal state. Never throws. */
export async function execute(
  kernel: SupervisorKernel,
  run: Active,
  harness: Harness,
  prompt: string,
) {
  const wallTime = run.snapshot.budget?.wallTimeMs;
  const timer =
    wallTime === undefined ? undefined : setTimeout(() => exceed(run, 'wall time'), wallTime);
  try {
    abortCheck(run);
    const status = await harness.availability();
    if (!status.available) throw new Error(status.reason ?? 'Harness unavailable');
    abortCheck(run);
    await setState(kernel, run, 'running');
    const calls: Calls = new Map();
    // A harness that resumes its native session already holds the earlier turns.
    const earlier =
      harness.features.resume || run.snapshot.conversationId === run.snapshot.id
        ? []
        : await earlierTurns(kernel, run.snapshot);
    await streamTurn(kernel, run, harness, prompt, calls, earlier);
    // A native terminal event cannot overtake an application call still in flight. A refusal
    // the harness handed back to its model does not fail the run; the harness decides that.
    await Promise.allSettled([...calls.values()].map((call) => call.result));
    abortCheck(run);
    await setState(kernel, run, 'succeeded');
  } catch (error) {
    await completeFailure(kernel, run, error);
  } finally {
    clearTimeout(timer);
    // Every path, cancellation and lost persistence included, ends here in a terminal state.
    observe(kernel, run.snapshot, 'ended');
    // Retain the terminal snapshot in the store; active entries hold no provider tokens.
    if (!run.persistenceFailed) kernel.active.delete(run.snapshot.id);
  }
}

import { randomUUID } from 'node:crypto';
import { ApplicationError, type ModelRequirement } from '@agent-native/contracts';
import { satisfiesModel, type ModelDemand } from '../placement';
import type { Harness, RunBudget, RunSnapshot } from '../types';
import { terminalStates } from '../types';
import { execute } from './execute';
import { observe, setState, type Active, type SupervisorKernel } from './run';

export interface StartInput {
  harnessId: string;
  prompt: string;
  conversationId?: string;
  context?: Record<string, unknown>;
  resumeData?: Record<string, string>;
  /** Limits for this run, usually an agent definition's budgets. */
  budget?: RunBudget;
  /**
   * A caller-chosen run ID, for example one key per trigger event, so a run repeated after a
   * restart reuses its tool calls' idempotency keys. Starting an ID the supervisor still holds
   * throws; a random ID is used when omitted.
   */
  id?: string;
  /** The agent definition's model requirement; a harness that does not meet it is refused. */
  model?: ModelRequirement;
  /** The definition's named models and its ID, checked with `model` (`ModelDemand`). */
  demand?: ModelDemand;
}

/**
 * Queue a run. Turns of one conversation execute one after another, so a native session is
 * never resumed twice at once; a failed turn does not block the next.
 */
export async function startRun(
  kernel: SupervisorKernel,
  conversations: Map<string, Promise<void>>,
  harness: Harness,
  input: StartInput,
) {
  if (input.model && !satisfiesModel(input.model, harness, input.demand))
    throw new ApplicationError(
      'FORBIDDEN',
      `Harness ${harness.id} does not meet the ${input.model} model requirement`,
    );
  const id = input.id ?? randomUUID();
  if (input.id !== undefined && (kernel.active.has(id) || (await kernel.store.get(id))))
    throw new Error(`Run ${id} already exists`);
  const at = kernel.timestamp();
  const snapshot: RunSnapshot = {
    id,
    harnessId: harness.id,
    conversationId: input.conversationId ?? id,
    state: 'queued',
    createdAt: at,
    updatedAt: at,
    context: structuredClone(input.context ?? {}),
    events: [],
    nextSequence: 1,
    resumeData: input.resumeData,
    ...(input.budget ? { budget: structuredClone(input.budget) } : {}),
    ...(harness.model ? { model: { ...harness.model } } : {}),
  };
  const run: Active = {
    controller: new AbortController(),
    snapshot,
    subscribers: new Set(),
    write: Promise.resolve(),
    outputChars: 0,
    textCarry: '',
  };
  kernel.active.set(id, run);
  await setState(kernel, run, 'queued');
  observe(kernel, snapshot, 'started');
  const previous = conversations.get(snapshot.conversationId) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(() => execute(kernel, run, harness, input.prompt));
  conversations.set(snapshot.conversationId, task);
  task
    .catch(() => {})
    .finally(() => {
      if (conversations.get(snapshot.conversationId) === task)
        conversations.delete(snapshot.conversationId);
    });
  return structuredClone(snapshot);
}

export async function cancelRun(kernel: SupervisorKernel, id: string) {
  const run = kernel.active.get(id);
  if (!run) return kernel.store.get(id);
  run.controller.abort(new Error('Run cancelled'));
  run.pending?.reject(new Error('Run cancelled'));
  if (!terminalStates.has(run.snapshot.state)) await setState(kernel, run, 'cancelled');
  return structuredClone(run.snapshot);
}

/** The pending request a response names, or an error saying it is no longer pending. */
export function pendingRequest(
  kernel: SupervisorKernel,
  id: string,
  requestId: string,
  kind: 'question' | 'approval',
) {
  const run = kernel.active.get(id);
  const pending = run?.pending;
  if (
    !run ||
    !pending ||
    pending.id !== requestId ||
    pending.kind !== kind ||
    run.controller.signal.aborted
  )
    throw new Error(`${kind === 'question' ? 'Question' : 'Approval'} is no longer pending`);
  return { run, pending };
}

/** Mark runs a previous process left unfinished as interrupted; they are never resumed. */
export async function recoverInterrupted(kernel: SupervisorKernel) {
  for (const snapshot of await kernel.store.list())
    if (!terminalStates.has(snapshot.state) && !kernel.active.has(snapshot.id)) {
      snapshot.state = 'interrupted';
      snapshot.updatedAt = kernel.timestamp();
      snapshot.failure = {
        code: 'HOST_RESTARTED',
        message: 'Host restarted; explicit recovery is required',
      };
      snapshot.events.push({
        type: 'state',
        state: 'interrupted',
        sequence: snapshot.nextSequence++,
        at: snapshot.updatedAt,
      });
      snapshot.events = snapshot.events.slice(-256);
      await kernel.store.save(snapshot);
      observe(kernel, snapshot, 'ended');
    }
}

import { randomUUID } from 'node:crypto';
import type { RunEvent, RunSnapshot, RunState, RunStore } from '../types';
import { terminalStates } from '../types';
import type { SupervisorOptions } from '../supervisor';
import type { EventQueue } from './event-queue';
import type { Redactor } from './redaction';

/** A run this process is executing. Holds no provider tokens. */
export type Active = {
  controller: AbortController;
  snapshot: RunSnapshot;
  pending?: {
    id: string;
    kind: 'question' | 'approval';
    choices?: readonly string[];
    resolve(value: string | boolean): void;
    reject(error: Error): void;
  };
  subscribers: Set<EventQueue>;
  write: Promise<void>;
  outputChars: number;
  /** Raw streamed text held back because a secret or token may continue in the next delta. */
  textCarry: string;
  persistenceFailed?: boolean;
  /** Set when a budget stopped the run, so the abort reads as a failure, not a cancellation. */
  budgetExceeded?: string;
};

/** What every part of the supervisor shares. */
export interface SupervisorKernel {
  readonly options: SupervisorOptions;
  readonly store: RunStore;
  readonly active: Map<string, Active>;
  readonly timestamp: () => string;
  readonly redactor: Redactor;
}

/** Tell the supervisor's observer about a run; its errors never reach the run. */
export function observe(
  kernel: SupervisorKernel,
  snapshot: RunSnapshot,
  change: 'started' | 'ended',
) {
  try {
    kernel.options.onRun?.(structuredClone(snapshot), change);
  } catch {
    // An observer is evidence only; a run never fails because of it.
  }
}

/** Stop the run when its store stops writing; nothing continues on in-memory success. */
function failPersistence(run: Active) {
  // A durable run command result is a prerequisite for subsequent tool work. Do not
  // continue on an in-memory-only success when the selected store stops writing.
  run.persistenceFailed = true;
  run.snapshot.state = 'failed';
  run.snapshot.failure = {
    code: 'RUN_STORE_FAILED',
    message: 'Run persistence failed; work was stopped',
  };
  run.controller.abort(new Error('Run persistence failed'));
  run.pending?.reject(new Error('Run persistence failed'));
  for (const subscriber of run.subscribers)
    subscriber.end(new Error('Run persistence failed; fetch run status'));
}

/** Scrub, bound, persist, then publish one event. Subscribers see only persisted events. */
export async function emit(
  kernel: SupervisorKernel,
  run: Active,
  event: Omit<RunEvent, 'sequence' | 'at'>,
) {
  const entry: RunEvent = {
    ...event,
    sequence: run.snapshot.nextSequence++,
    at: kernel.timestamp(),
  };
  for (const field of ['text', 'message'] as const)
    if (entry[field]) {
      const remaining = Math.max(0, (kernel.options.maxOutputChars ?? 64_000) - run.outputChars);
      entry[field] = kernel.redactor.scrub(entry[field]!).slice(0, Math.min(remaining, 8_000));
      run.outputChars += entry[field]!.length;
    }
  run.snapshot.updatedAt = entry.at;
  run.snapshot.events.push(entry);
  run.snapshot.events = run.snapshot.events.slice(-256);
  const persisted = structuredClone(run.snapshot);
  run.write = run.write
    .then(() => kernel.store.save(persisted))
    .catch((error) => {
      failPersistence(run);
      throw error;
    });
  await run.write;
  for (const subscriber of run.subscribers) subscriber.push(entry);
}

/**
 * Streamed text is released in pieces of at least this many characters. A model streams a token
 * per delta, and a run keeps its last 256 events, so a long reply in single tokens would push
 * out its own beginning and the tool calls before it.
 */
const TEXT_EVENT_CHARS = 200;

export async function emitText(kernel: SupervisorKernel, run: Active, text: string) {
  const combined = run.textCarry + text;
  const cut = kernel.redactor.safeCut(combined);
  if (cut < TEXT_EVENT_CHARS) {
    run.textCarry = combined;
    return;
  }
  run.textCarry = combined.slice(cut);
  await emit(kernel, run, { type: 'text', text: combined.slice(0, cut) });
}

export async function flushText(kernel: SupervisorKernel, run: Active) {
  const text = run.textCarry;
  run.textCarry = '';
  if (text) await emit(kernel, run, { type: 'text', text });
}

export async function setState(kernel: SupervisorKernel, run: Active, state: RunState) {
  run.snapshot.state = state;
  await emit(kernel, run, { type: 'state', state });
  if (terminalStates.has(state)) {
    for (const subscriber of run.subscribers) subscriber.end();
  }
}

export function abortCheck(run: Active) {
  run.controller.signal.throwIfAborted();
}

/** Ask the person a question or for an approval; one may be pending per run, with a timeout. */
export async function request(
  kernel: SupervisorKernel,
  run: Active,
  kind: 'question' | 'approval',
  message: string,
  choices?: readonly string[],
) {
  abortCheck(run);
  if (run.pending) throw new Error('Only one question or approval may be pending per run');
  const requestId = randomUUID();
  const response = new Promise<string | boolean>((resolve, reject) => {
    run.pending = { id: requestId, kind, choices, resolve, reject };
  });
  const timeout = setTimeout(
    () =>
      run.pending?.reject(
        new Error(`${kind === 'question' ? 'Question' : 'Approval'} response timed out`),
      ),
    kernel.options.questionTimeoutMs ?? 300_000,
  );
  // Install the rejection handler before persistence can yield or fail.
  response.catch(() => {});
  try {
    await setState(kernel, run, kind === 'question' ? 'awaiting-question' : 'awaiting-approval');
    await emit(kernel, run, {
      type: kind,
      requestId,
      message,
      choices: choices?.map((choice) => kernel.redactor.scrub(choice).slice(0, 200)),
    });
    const value = await response;
    abortCheck(run);
    // The answer is kept with the run, so a conversation shows it after a reload.
    await emit(kernel, run, {
      type: 'answer',
      requestId,
      ...(typeof value === 'boolean' ? { approved: value } : { text: value }),
    });
    await setState(kernel, run, 'running');
    return value;
  } finally {
    clearTimeout(timeout);
    run.pending = undefined;
  }
}

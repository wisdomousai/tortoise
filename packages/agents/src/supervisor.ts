import { randomUUID } from 'node:crypto';
import type {
  Harness,
  HarnessEvent,
  RunEvent,
  RunSnapshot,
  RunState,
  RunStore,
  ToolPort,
} from './types';
import { terminalStates } from './types';

export class MemoryRunStore implements RunStore {
  private readonly records = new Map<string, RunSnapshot>();
  async get(id: string) {
    const value = this.records.get(id);
    return value && structuredClone(value);
  }
  async list() {
    return [...this.records.values()].map((value) => structuredClone(value));
  }
  async save(snapshot: RunSnapshot) {
    this.records.set(snapshot.id, structuredClone(snapshot));
  }
}

export interface SupervisorOptions {
  harnesses: readonly Harness[];
  tools: ToolPort;
  store?: RunStore;
  maxOutputChars?: number;
  /** Explicitly supplied secrets, never values discovered from environment/config. */
  redact?: readonly string[];
  now?: () => Date;
  questionTimeoutMs?: number;
}
type Active = {
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
  persistenceFailed?: boolean;
};

/** Bounded event delivery. A slow consumer receives an explicit replay-required error
 * instead of silently losing state transitions. Snapshots retain recent history. */
class EventQueue implements AsyncIterableIterator<RunEvent> {
  private queue: RunEvent[] = [];
  private waiting?: { resolve(value: IteratorResult<RunEvent>): void; reject(error: Error): void };
  private closed = false;
  private error?: Error;
  constructor(private readonly onClose: () => void) {}
  push(event: RunEvent) {
    if (this.closed) return;
    if (this.waiting) {
      this.waiting.resolve({ done: false, value: event });
      this.waiting = undefined;
    } else if (this.queue.length >= 256)
      this.end(new Error('Run event consumer fell behind; fetch the run snapshot'));
    else this.queue.push(event);
  }
  end(error?: Error) {
    this.closed = true;
    this.error = error;
    if (this.waiting) {
      error ? this.waiting.reject(error) : this.waiting.resolve({ done: true, value: undefined });
      this.waiting = undefined;
    }
    this.onClose();
  }
  next(): Promise<IteratorResult<RunEvent>> {
    const value = this.queue.shift();
    if (value) return Promise.resolve({ done: false, value });
    if (this.error) return Promise.reject(this.error);
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }
  async return() {
    this.end();
    return { done: true as const, value: undefined };
  }
  [Symbol.asyncIterator]() {
    return this;
  }
}

export function createRunSupervisor(options: SupervisorOptions) {
  const store = options.store ?? new MemoryRunStore();
  const harnesses = new Map(options.harnesses.map((harness) => [harness.id, harness]));
  if (harnesses.size !== options.harnesses.length) throw new Error('Duplicate harness IDs');
  const active = new Map<string, Active>();
  const conversations = new Map<string, Promise<void>>();
  const timestamp = () => (options.now?.() ?? new Date()).toISOString();
  const scrub = (value: string) => {
    let result = value;
    for (const secret of options.redact ?? [])
      if (secret) result = result.split(secret).join('[redacted]');
    return result
      .replace(/\bBearer\s+[\w.\-]+/gi, 'Bearer [redacted]')
      .replace(/\b(?:sk|sk-ant)-[\w\-]{8,}/g, '[redacted]')
      .replace(
        /("?(?:access_token|refresh_token|api_key|id_token)"?\s*[:=]\s*")[^"]*/gi,
        '$1[redacted]',
      );
  };
  async function emit(run: Active, event: Omit<RunEvent, 'sequence' | 'at'>) {
    const entry: RunEvent = { ...event, sequence: run.snapshot.nextSequence++, at: timestamp() };
    for (const field of ['text', 'message'] as const)
      if (entry[field]) {
        const remaining = Math.max(0, (options.maxOutputChars ?? 64_000) - run.outputChars);
        entry[field] = scrub(entry[field]!).slice(0, Math.min(remaining, 8_000));
        run.outputChars += entry[field]!.length;
      }
    run.snapshot.updatedAt = entry.at;
    run.snapshot.events.push(entry);
    run.snapshot.events = run.snapshot.events.slice(-256);
    const persisted = structuredClone(run.snapshot);
    run.write = run.write
      .then(() => store.save(persisted))
      .catch((error) => {
        // A durable run receipt is a prerequisite for subsequent tool work. Do not
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
        throw error;
      });
    await run.write;
    for (const subscriber of run.subscribers) subscriber.push(entry);
  }
  async function setState(run: Active, state: RunState) {
    run.snapshot.state = state;
    await emit(run, { type: 'state', state });
    if (terminalStates.has(state)) {
      for (const subscriber of run.subscribers) subscriber.end();
    }
  }
  function abortCheck(run: Active) {
    run.controller.signal.throwIfAborted();
  }
  async function request(
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
      options.questionTimeoutMs ?? 300_000,
    );
    // Install the rejection handler before persistence can yield or fail.
    response.catch(() => {});
    try {
      await setState(run, kind === 'question' ? 'awaiting-question' : 'awaiting-approval');
      await emit(run, {
        type: kind,
        requestId,
        message,
        choices: choices?.map((choice) => scrub(choice).slice(0, 200)),
      });
      const value = await response;
      abortCheck(run);
      await setState(run, 'running');
      return value;
    } finally {
      clearTimeout(timeout);
      run.pending = undefined;
    }
  }
  async function execute(run: Active, harness: Harness, prompt: string) {
    try {
      abortCheck(run);
      const status = await harness.availability();
      if (!status.available) throw new Error(status.reason ?? 'Harness unavailable');
      abortCheck(run);
      await setState(run, 'running');
      const calls = new Map<string, { fingerprint: string; result: Promise<unknown> }>();
      const tools: ToolPort = {
        definitions: options.tools.definitions,
        execute(operation, input, context) {
          abortCheck(run);
          if (terminalStates.has(run.snapshot.state)) throw new Error('Run is already terminal');
          const id = context.idempotencyKey ?? randomUUID();
          const fingerprint = JSON.stringify([operation, input]);
          let call = calls.get(id);
          if (call && call.fingerprint !== fingerprint)
            throw new Error('Tool invocation ID reused with different arguments');
          if (!call) {
            const result = options.tools.execute(operation, input, {
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
      for await (const event of harness.run({
        runId: run.snapshot.id,
        conversationId: run.snapshot.conversationId,
        prompt,
        context: Object.freeze(structuredClone(run.snapshot.context)),
        signal: run.controller.signal,
        resumeData: run.snapshot.resumeData,
        tools,
        question: async (message, choices) =>
          String(await request(run, 'question', message, choices)),
        approve: async (message) => Boolean(await request(run, 'approval', message)),
      })) {
        abortCheck(run);
        if (event.type === 'resume-data') {
          run.snapshot.resumeData = structuredClone(event.data);
          await emit(run, { type: 'progress', message: 'Native session recorded' });
        } else await emit(run, event);
      }
      // A native terminal event cannot overtake an application call still in flight.
      await Promise.all([...calls.values()].map((call) => call.result));
      abortCheck(run);
      await setState(run, 'succeeded');
    } catch (error) {
      if (terminalStates.has(run.snapshot.state)) return;
      if (run.controller.signal.aborted) await setState(run, 'cancelled');
      else {
        run.snapshot.failure = {
          code: 'HARNESS_FAILED',
          message: scrub(error instanceof Error ? error.message : String(error)).slice(0, 2000),
        };
        run.controller.abort(new Error('Harness failed'));
        await setState(run, 'failed');
      }
    } finally {
      // Retain the terminal snapshot in the store; active entries hold no provider tokens.
      if (!run.persistenceFailed) active.delete(run.snapshot.id);
    }
  }
  return {
    async start(input: {
      harnessId: string;
      prompt: string;
      conversationId?: string;
      context?: Record<string, unknown>;
      resumeData?: Record<string, string>;
    }) {
      const harness = harnesses.get(input.harnessId);
      if (!harness) throw new Error(`Unknown harness: ${input.harnessId}`);
      const id = randomUUID();
      const at = timestamp();
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
      };
      const run: Active = {
        controller: new AbortController(),
        snapshot,
        subscribers: new Set(),
        write: Promise.resolve(),
        outputChars: 0,
      };
      active.set(id, run);
      await setState(run, 'queued');
      const previous = conversations.get(snapshot.conversationId) ?? Promise.resolve();
      const task = previous.catch(() => {}).then(() => execute(run, harness, input.prompt));
      conversations.set(snapshot.conversationId, task);
      task
        .catch(() => {})
        .finally(() => {
          if (conversations.get(snapshot.conversationId) === task)
            conversations.delete(snapshot.conversationId);
        });
      return structuredClone(snapshot);
    },
    get: (id: string) =>
      active.has(id) ? Promise.resolve(structuredClone(active.get(id)!.snapshot)) : store.get(id),
    async list() {
      const snapshots = new Map((await store.list()).map((snapshot) => [snapshot.id, snapshot]));
      for (const [id, run] of active) snapshots.set(id, structuredClone(run.snapshot));
      return [...snapshots.values()];
    },
    async cancel(id: string) {
      const run = active.get(id);
      if (!run) return store.get(id);
      run.controller.abort(new Error('Run cancelled'));
      run.pending?.reject(new Error('Run cancelled'));
      if (!terminalStates.has(run.snapshot.state)) await setState(run, 'cancelled');
      return structuredClone(run.snapshot);
    },
    async respondQuestion(id: string, requestId: string, answer: string) {
      const run = active.get(id);
      const pending = run?.pending;
      if (
        !run ||
        !pending ||
        pending.id !== requestId ||
        pending.kind !== 'question' ||
        run.controller.signal.aborted
      )
        throw new Error('Question is no longer pending');
      if (pending.choices && !pending.choices.includes(answer))
        throw new Error('Answer is not an offered choice');
      run.pending = undefined;
      pending.resolve(answer);
    },
    async respondApproval(id: string, requestId: string, approved: boolean) {
      const run = active.get(id);
      const pending = run?.pending;
      if (
        !run ||
        !pending ||
        pending.id !== requestId ||
        pending.kind !== 'approval' ||
        run.controller.signal.aborted
      )
        throw new Error('Approval is no longer pending');
      run.pending = undefined;
      pending.resolve(approved);
    },
    async *events(id: string, afterSequence = 0): AsyncIterable<RunEvent> {
      const run = active.get(id);
      const snapshot = run?.snapshot ?? (await store.get(id));
      if (!snapshot) throw new Error('Run not found');
      const earliest = snapshot.events[0]?.sequence ?? snapshot.nextSequence;
      if (afterSequence < earliest - 1)
        throw new Error('Run replay cursor expired; fetch the run snapshot');
      let queue: EventQueue | undefined;
      if (run && !terminalStates.has(snapshot.state)) {
        queue = new EventQueue(() => run.subscribers.delete(queue!));
        run.subscribers.add(queue);
      }
      // Registration occurs before replay; duplicates from concurrent publication are filtered.
      let cursor = afterSequence;
      try {
        for (const event of [...snapshot.events])
          if (event.sequence > cursor) {
            cursor = event.sequence;
            yield structuredClone(event);
          }
        if (queue)
          for await (const event of queue)
            if (event.sequence > cursor) {
              cursor = event.sequence;
              yield structuredClone(event);
            }
      } finally {
        await queue?.return();
      }
    },
    async recoverInterrupted() {
      for (const snapshot of await store.list())
        if (!terminalStates.has(snapshot.state) && !active.has(snapshot.id)) {
          snapshot.state = 'interrupted';
          snapshot.updatedAt = timestamp();
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
          await store.save(snapshot);
        }
    },
  };
}

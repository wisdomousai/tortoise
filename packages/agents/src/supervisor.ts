import type { Harness, RunEvent, RunSnapshot, RunStore, ToolPort } from './types';
import {
  cancelRun,
  pendingRequest,
  recoverInterrupted,
  startRun,
  type StartInput,
} from './supervisor/lifecycle';
import { MemoryRunStore } from './supervisor/memory-run-store';
import { createRedactor } from './supervisor/redaction';
import { runEvents } from './supervisor/replay';
import type { SupervisorKernel } from './supervisor/run';

export { MemoryRunStore } from './supervisor/memory-run-store';
export { runAuditRecord } from './supervisor/audit';

export interface SupervisorOptions {
  harnesses: readonly Harness[];
  tools: ToolPort;
  store?: RunStore;
  maxOutputChars?: number;
  /** Explicitly supplied secrets, never values discovered from environment/config. */
  redact?: readonly string[];
  now?: () => Date;
  questionTimeoutMs?: number;
  /**
   * Told when a run is queued and once when it ends (including runs a previous process left,
   * marked interrupted on recovery), for example to append `run.started` and `run.ended` to the
   * audit log with `runAuditRecord`. It must not throw; an error it throws is ignored.
   */
  onRun?: (snapshot: Readonly<RunSnapshot>, change: 'started' | 'ended') => void;
}

export function createRunSupervisor(options: SupervisorOptions) {
  const store = options.store ?? new MemoryRunStore();
  const harnesses = new Map(options.harnesses.map((harness) => [harness.id, harness]));
  if (harnesses.size !== options.harnesses.length) throw new Error('Duplicate harness IDs');
  const kernel: SupervisorKernel = {
    options,
    store,
    active: new Map(),
    timestamp: () => (options.now?.() ?? new Date()).toISOString(),
    redactor: createRedactor(options.redact),
  };
  const { active } = kernel;
  const conversations = new Map<string, Promise<void>>();
  return {
    async start(input: StartInput) {
      const harness = harnesses.get(input.harnessId);
      if (!harness) throw new Error(`Unknown harness: ${input.harnessId}`);
      return startRun(kernel, conversations, harness, input);
    },
    get: (id: string) =>
      active.has(id) ? Promise.resolve(structuredClone(active.get(id)!.snapshot)) : store.get(id),
    async list() {
      const snapshots = new Map((await store.list()).map((snapshot) => [snapshot.id, snapshot]));
      for (const [id, run] of active) snapshots.set(id, structuredClone(run.snapshot));
      return [...snapshots.values()];
    },
    cancel: (id: string) => cancelRun(kernel, id),
    async respondQuestion(id: string, requestId: string, answer: string) {
      const { run, pending } = pendingRequest(kernel, id, requestId, 'question');
      if (pending.choices && !pending.choices.includes(answer))
        throw new Error('Answer is not an offered choice');
      run.pending = undefined;
      pending.resolve(answer);
    },
    async respondApproval(id: string, requestId: string, approved: boolean) {
      const { run, pending } = pendingRequest(kernel, id, requestId, 'approval');
      run.pending = undefined;
      pending.resolve(approved);
    },
    events: (id: string, afterSequence = 0): AsyncIterable<RunEvent> =>
      runEvents(kernel, id, afterSequence),
    recoverInterrupted: () => recoverInterrupted(kernel),
  };
}

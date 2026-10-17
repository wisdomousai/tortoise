import { createHash } from 'node:crypto';
import { canonicalJson } from '@agent-native/contracts';
import type { Harness, HarnessEvent, HarnessTurn } from '@agent-native/agents/types';

/** A committed change, as the journal reports it. */
export interface TriggerEvent {
  readonly cursor: number;
  readonly resource: string;
  readonly revision: number;
  readonly type: string;
  readonly operation: string;
}

/**
 * What a job receives: the event or slot that started it and the application's operations,
 * called as the grant's issuer narrowed to the trigger's operations. A call's idempotency key
 * comes from the run, the operation, its input and how often the run made that same call, so a
 * job that runs again after a restart replays every command it already committed, even when a
 * query now returns other rows and the job makes other calls in between.
 */
export interface JobContext {
  readonly trigger: string;
  readonly event?: TriggerEvent;
  readonly slot?: number;
  readonly signal: AbortSignal;
  query<T = unknown>(operation: string, input: unknown): Promise<{ data: T; cursor: number }>;
  command<T = unknown>(
    operation: string,
    input: unknown,
    options?: { expectedRevisions?: Record<string, number> },
  ): Promise<{ result: T; revisions: Record<string, number> }>;
}

/** A deterministic job. It changes state only through `command`; a throw fails the run. */
export type Job = (context: JobContext) => Promise<void>;

/** What a job run's prompt carries; never written by a person or a model. */
export interface JobPrompt {
  readonly job: string;
  readonly trigger: string;
  readonly event?: TriggerEvent;
  readonly slot?: number;
}

export const JOB_HARNESS = 'automation-job';

/**
 * Runs registered jobs inside the run supervisor, so a job run has the same budgets, run record
 * and cancellation as an agent run. Every call goes through the supervisor's tool port.
 */
export function createJobHarness(jobs: ReadonlyMap<string, Job>): Harness {
  return {
    id: JOB_HARNESS,
    features: { questions: false, approvals: false, resume: false },
    availability: async () => ({ available: true }),
    async *run(turn: HarnessTurn): AsyncIterable<HarnessEvent> {
      const prompt = JSON.parse(turn.prompt) as JobPrompt;
      const job = jobs.get(prompt.job);
      if (!job) throw new Error(`Unknown job ${prompt.job}`);
      const events: HarnessEvent[] = [];
      const seen = new Map<string, number>();
      let reads = 0;
      const call = async (operation: string, body: unknown, write: boolean) => {
        turn.signal.throwIfAborted();
        const digest = createHash('sha256')
          .update(canonicalJson([operation, body]))
          .digest('hex');
        const repeat = (seen.get(digest) ?? 0) + 1;
        if (write) seen.set(digest, repeat);
        // A repeated read must read again, so only commands share keys by content.
        const callId = write ? `${digest.slice(0, 32)}:${repeat}` : `read:${++reads}`;
        events.push({ type: 'tool-start', operation, callId });
        const result = await turn.tools.execute(operation, body, {
          runId: turn.runId,
          signal: turn.signal,
          idempotencyKey: callId,
        });
        events.push({ type: 'tool-finish', operation, callId });
        return result as never;
      };
      await job({
        trigger: prompt.trigger,
        ...(prompt.event ? { event: prompt.event } : {}),
        ...(prompt.slot === undefined ? {} : { slot: prompt.slot }),
        signal: turn.signal,
        query: (operation, input) => call(operation, { input }, false),
        command: (operation, input, options) => call(operation, { input, ...options }, true),
      });
      yield* events;
    },
  };
}

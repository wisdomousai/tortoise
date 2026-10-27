import { createHash } from 'node:crypto';
import type { CommandReceipt, ExecutionContext, Invocation } from '@agent-native/runtime';
import type { ObservedReading } from './stability';

/**
 * What every observation carries, whatever the source: when its frame was taken, the frame's
 * digest and the gated readings. A source adds its own context (station and screen, or device and
 * mode) as further fields.
 */
export interface ObservationBase {
  readonly observedAt: number;
  readonly frameDigest: string;
  readonly readings: readonly ObservedReading<unknown>[];
}

export interface ObserverOptions<Observation extends ObservationBase> {
  /** Names the source in idempotency keys: `observe:<source>:<payload fingerprint>`. */
  readonly source: string;
  /** Take one frame and build its observation, readings already gated. */
  readonly sample: (signal: AbortSignal) => Promise<Observation>;
  readonly application: {
    invokeRaw(request: Invocation, context: ExecutionContext): Promise<CommandReceipt>;
  };
  /** The observing principal, granted the ingest operation only. */
  readonly context: ExecutionContext;
  readonly ingestOperation: string;
  /** Map an observation to the ingest command's input. Defaults to the observation itself. */
  readonly toInput?: (observation: Observation) => unknown;
  /** Unchanged content is resubmitted at most this often, so freshness keeps advancing. */
  readonly heartbeatMs?: number;
}

/** Hash of what the observation says; times and digests are excluded. */
function contentOf({ observedAt: _at, frameDigest: _digest, ...rest }: ObservationBase) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        ...rest,
        readings: rest.readings.map(
          ({ observedAt: _at, frameDigest: _digest, ...reading }) => reading,
        ),
      }),
    )
    .digest('hex');
}

/** Submit through the ingest command under a key fingerprinting the exact payload. */
function submit<Observation extends ObservationBase>(
  options: ObserverOptions<Observation>,
  observation: Observation,
) {
  const input = options.toInput ? options.toInput(observation) : observation;
  // The key fingerprints the exact payload: a retry of this payload reuses it, and a different
  // payload (a later frame, or a return to an earlier state) can never collide with it.
  const payload = createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32);
  return options.application.invokeRaw(
    {
      operation: options.ingestOperation,
      input,
      idempotencyKey: `observe:${options.source}:${payload}`,
    },
    options.context,
  );
}

/** Run `pass` every `intervalMs` until `signal` aborts; a failed pass goes to `onError`. */
async function repeat(
  signal: AbortSignal,
  intervalMs: number,
  pass: (signal: AbortSignal) => Promise<unknown>,
  onError?: (error: unknown) => void,
) {
  while (!signal.aborted) {
    await pass(signal).catch((error) => onError?.(error));
    // A stop during the pass has already fired `abort`, so waiting for it would sleep out the
    // whole interval.
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), {
        once: true,
      });
    });
  }
}

/**
 * Watches a source and reports what it shows through the domain's ingest command. It never
 * writes storage and never acts on the source. Unchanged content is resubmitted at most once per
 * heartbeat window, so a static source does not grow the journal; each submission's idempotency
 * key is derived from its exact payload, so keys are never reused for different input. A failed
 * submission is not remembered, so the next pass sends it again.
 */
export function createObserver<Observation extends ObservationBase>(
  options: ObserverOptions<Observation>,
) {
  const heartbeatMs = options.heartbeatMs ?? 10_000;
  // The last accepted submission; a failed one is not recorded, so the next pass resends.
  let last: { content: string; window: number; receipt: CommandReceipt } | undefined;

  async function runOnce(signal: AbortSignal = new AbortController().signal) {
    const observation = await options.sample(signal);
    // Same content as the previous submission within one heartbeat window is not resent; times
    // and digests are excluded from the content hash. Anything else is a new submission.
    const content = contentOf(observation);
    const window = Math.floor(observation.observedAt / heartbeatMs);
    if (last && last.content === content && last.window === window)
      return { observation, receipt: last.receipt };
    const receipt = await submit(options, observation);
    last = { content, window, receipt };
    return { observation, receipt };
  }

  let controller: AbortController | undefined;
  let running: Promise<void> | undefined;
  return {
    runOnce,
    /** Observe every `intervalMs` until stopped; a failed pass is retried on the next tick. */
    start(intervalMs: number, onError?: (error: unknown) => void) {
      if (controller) return;
      const active = new AbortController();
      controller = active;
      running = repeat(active.signal, intervalMs, runOnce, onError);
    },
    async stop() {
      controller?.abort();
      await running;
      controller = undefined;
      running = undefined;
    },
  };
}
export type Observer<Observation extends ObservationBase> = ReturnType<
  typeof createObserver<Observation>
>;

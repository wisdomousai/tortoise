import { createHash } from 'node:crypto';
import type { CommandReceipt, ExecutionContext, Invocation } from '@agent-native/runtime';
import type { Extractor, ScreenTransport } from './ports';
import {
  StabilityGate,
  createPerception,
  type Perception,
  type Reading,
  type View,
} from './perceive';
import type { StationProfile } from './profile';

/**
 * One observation as submitted to the domain's ingest command. Only stable readings are
 * included; each is `observed` (confident enough to become fact) or `uncertain` (stable but below
 * the field's threshold: the domain asks a person instead of recording it).
 */
export interface Observation {
  readonly station: string;
  readonly profile: { readonly id: string; readonly version: string };
  readonly screen: string | null;
  readonly observedAt: number;
  readonly frameDigest: string;
  /** A person used the station's own input since the previous observation. */
  readonly localInput: boolean;
  readonly readings: readonly (Reading & {
    readonly status: 'observed' | 'uncertain';
    readonly minConfidence: number;
    /** The profile's declaration for the field, so a correction uses the right value type. */
    readonly declared: FieldDeclaration;
  })[];
}

/** What a profile declares about a field's value: its type and, where given, options and format. */
export interface FieldDeclaration {
  readonly type: StationProfile['fields'][number]['type'];
  readonly options?: readonly string[];
  readonly decimals?: number;
  readonly unit?: string;
}

export interface StationObserverOptions {
  readonly station: string;
  readonly profile: StationProfile;
  readonly transport: ScreenTransport;
  readonly extractors: readonly Extractor[];
  readonly application: {
    invokeRaw(request: Invocation, context: ExecutionContext): Promise<CommandReceipt>;
  };
  /** Bridge principal, granted the ingest operation only. */
  readonly context: ExecutionContext;
  readonly ingestOperation: string;
  /** Map an observation to the ingest command's input. Defaults to the observation itself. */
  readonly toInput?: (observation: Observation) => unknown;
  /** An unchanged screen is resubmitted at most this often, so freshness keeps advancing. */
  readonly heartbeatMs?: number;
}

type ObservedReading = Observation['readings'][number];

/** The profile's declaration for a field, carried with each reading. */
const declarationOf = (field: StationProfile['fields'][number]): FieldDeclaration => ({
  type: field.type,
  ...(field.options ? { options: field.options } : {}),
  ...(field.decimals !== undefined ? { decimals: field.decimals } : {}),
  ...(field.unit ? { unit: field.unit } : {}),
});

/** Readings that passed the stability gate, each marked observed or uncertain. */
function stableReadings(
  perception: Perception,
  gate: StabilityGate,
  view: View,
): ObservedReading[] {
  gate.retain(new Set(view.readings.keys()));
  const readings: ObservedReading[] = [];
  for (const reading of view.readings.values()) {
    const field = perception.field(reading.field)!;
    if (!gate.push(reading.field, reading.value, field.stableReads)) continue;
    readings.push({
      ...reading,
      status:
        reading.value !== null && reading.confidence >= field.minConfidence
          ? 'observed'
          : 'uncertain',
      minConfidence: field.minConfidence,
      declared: declarationOf(field),
    });
  }
  return readings;
}

/** Hash of what the observation says; times and digests are excluded. */
const contentOf = (observation: Observation) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        screen: observation.screen,
        localInput: observation.localInput,
        readings: observation.readings.map(
          ({ observedAt: _at, frameDigest: _digest, ...rest }) => rest,
        ),
      }),
    )
    .digest('hex');

/** Submit through the ingest command under a key fingerprinting the exact payload. */
function submit(options: StationObserverOptions, observation: Observation) {
  const input = options.toInput ? options.toInput(observation) : observation;
  // The key fingerprints the exact payload: a retry of this payload reuses it, and a different
  // payload (a later frame, or a return to an earlier state) can never collide with it.
  const payload = createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32);
  return options.application.invokeRaw(
    {
      operation: options.ingestOperation,
      input,
      idempotencyKey: `observe:${options.station}:${payload}`,
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
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), {
        once: true,
      });
    });
  }
}

/**
 * Watches a station screen and reports what it shows through the domain's ingest command, the
 * inbound half of the bridge. It never writes storage and never acts on the screen. A reading
 * must agree over `stableReads` consecutive captures before it is submitted, which filters
 * redraw flicker and one-off misreads. Unchanged content is resubmitted at most once per heartbeat
 * window, so a static screen does not grow the journal; each submission's idempotency key is
 * derived from its exact payload, so keys are never reused for different input.
 */
export function createStationObserver(options: StationObserverOptions) {
  const perception = createPerception(options.profile, options.extractors);
  const gate = new StabilityGate();
  const heartbeatMs = options.heartbeatMs ?? 10_000;
  let lastObservedAt: number | undefined;
  // The last accepted submission; a failed one is not recorded, so the next pass resends.
  let last: { content: string; window: number; receipt: CommandReceipt } | undefined;

  async function runOnce(signal: AbortSignal = new AbortController().signal) {
    const frame = await options.transport.capture(signal);
    const view = await perception.view(frame, signal);
    const localInput =
      lastObservedAt !== undefined && options.transport.localInputSince
        ? await options.transport.localInputSince(lastObservedAt, signal)
        : false;
    lastObservedAt = frame.capturedAt;
    const observation: Observation = {
      station: options.station,
      profile: { id: options.profile.id, version: options.profile.version },
      screen: view.screen ?? null,
      observedAt: frame.capturedAt,
      frameDigest: frame.digest,
      localInput,
      readings: stableReadings(perception, gate, view),
    };
    // Same content as the previous submission within one heartbeat window is not resent; times
    // and digests are excluded from the content hash. Anything else is a new submission.
    const content = contentOf(observation);
    const window = Math.floor(frame.capturedAt / heartbeatMs);
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

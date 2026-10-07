import { createHash } from 'node:crypto';
import type { CommandReceipt, ExecutionContext, Invocation } from '@agent-native/runtime';
import type { Extractor, ScreenTransport } from './ports';
import { StabilityGate, createPerception, type Reading } from './perceive';
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
  })[];
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

/**
 * Watches a station screen and reports what it shows through the domain's ingest command, the
 * inbound half of the bridge. It never writes storage and never acts on the screen. A reading
 * must agree over `stableReads` consecutive captures before it is submitted, which filters
 * redraw flicker and one-off misreads. Submissions are idempotent per content and heartbeat
 * window, so a static screen does not grow the journal.
 */
export function createStationObserver(options: StationObserverOptions) {
  const perception = createPerception(options.profile, options.extractors);
  const gate = new StabilityGate();
  const heartbeatMs = options.heartbeatMs ?? 10_000;
  let lastObservedAt: number | undefined;

  async function runOnce(signal: AbortSignal = new AbortController().signal) {
    const frame = await options.transport.capture(signal);
    const view = await perception.view(frame, signal);
    const localInput =
      lastObservedAt !== undefined && options.transport.localInputSince
        ? await options.transport.localInputSince(lastObservedAt, signal)
        : false;
    lastObservedAt = frame.capturedAt;
    gate.retain(new Set(view.readings.keys()));
    const readings: Observation['readings'][number][] = [];
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
      });
    }
    const observation: Observation = {
      station: options.station,
      profile: { id: options.profile.id, version: options.profile.version },
      screen: view.screen ?? null,
      observedAt: frame.capturedAt,
      frameDigest: frame.digest,
      localInput,
      readings,
    };
    // Same content within one heartbeat window is one submission; times are excluded from the hash.
    const content = createHash('sha256')
      .update(
        JSON.stringify({
          screen: observation.screen,
          localInput,
          readings: readings.map(({ observedAt: _at, frameDigest: _digest, ...rest }) => rest),
        }),
      )
      .digest('hex')
      .slice(0, 32);
    const window = Math.floor(frame.capturedAt / heartbeatMs);
    const receipt = await options.application.invokeRaw(
      {
        operation: options.ingestOperation,
        input: options.toInput ? options.toInput(observation) : observation,
        idempotencyKey: `observe:${options.station}:${content}:${window}`,
      },
      options.context,
    );
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
      running = (async () => {
        while (!active.signal.aborted) {
          await runOnce(active.signal).catch((error) => onError?.(error));
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, intervalMs);
            active.signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), {
              once: true,
            });
          });
        }
      })();
    },
    async stop() {
      controller?.abort();
      await running;
      controller = undefined;
      running = undefined;
    },
  };
}

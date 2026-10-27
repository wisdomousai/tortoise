import { auditServiceOf } from '@agent-native/audit';
import { readEvents } from '@agent-native/event-log';
import { defineHostPlugin, type PluginStartContext } from '@agent-native/host/plugin';
import { hostContext } from '@agent-native/kernel/application';
import { metricsRequest, tracesRequest, type BacklogPoint, type Resource } from './otlp';
import { TELEMETRY_DESTINATION, telemetryPluginManifest } from './plugin-manifest';
import { createRecorder, type RecorderOptions } from './recorder';

export interface TelemetryStatus {
  /** The last audit sequence turned into metrics and spans. */
  readonly position: number;
  readonly exports: number;
  readonly lastExport?: number;
  readonly lastError?: string;
  /** Spans dropped because the collector was unreachable for longer than the buffer holds. */
  readonly droppedSpans: number;
}

export interface TelemetryService {
  status(): TelemetryStatus;
  /** Read the audit log up to its head and export now, as the timer does. */
  flush(): Promise<void>;
}

export interface TelemetryOptions extends RecorderOptions {
  /** Between exports; one minute by default. */
  readonly intervalMs?: number;
  readonly now?: () => number;
}

const BATCH = 1_000;
const MAX_BATCHES = 10;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Outbox effects waiting now, counted by target and state as `drain` counts them. */
async function backlog(host: PluginStartContext): Promise<BacklogPoint[]> {
  const effects = await host.application.pendingEffects(hostContext(host.workspaceId), {
    limit: 10_000,
    includeHeld: true,
  });
  const counts = new Map<string, BacklogPoint>();
  for (const effect of effects) {
    const state =
      effect.heldAt !== undefined
        ? 'held'
        : effect.acknowledgedAt !== undefined
          ? 'acknowledged'
          : 'pending';
    const key = `${effect.target}\n${state}`;
    const point = counts.get(key) ?? { target: effect.target, state, count: 0 };
    counts.set(key, { ...point, count: point.count + 1 });
  }
  return [...counts.values()];
}

/**
 * OpenTelemetry metrics and traces for an instance, posted as OTLP/HTTP JSON to the
 * `telemetry` destination through the network port, so the egress guard binds, limits and logs
 * every export. The plugin follows the audit plugin's log from its head at start and the
 * outbox, and exports only operation IDs, outbox targets, harness IDs, outcomes, error codes,
 * counts and durations. Trace and span IDs are digests of correlation and run IDs.
 *
 * Metrics are cumulative since start, so an export the collector misses loses nothing but
 * resolution. Spans wait in a bounded buffer and the oldest are dropped when it fills. Nothing
 * here writes to the workspace or waits on the collector.
 */
export function createTelemetryPlugin(options: TelemetryOptions = {}) {
  const now = options.now ?? Date.now;
  return defineHostPlugin({
    manifest: telemetryPluginManifest,
    // The audit plugin's log is the source; composing it first gives `services.audit`.
    requires: ['audit'],
    async open(context) {
      const audit = auditServiceOf(context.services);
      const recorder = createRecorder(options);
      const resource: Resource = {
        'service.name': context.manifest.id,
        'service.instance.id': context.instance,
      };
      let status: TelemetryStatus = { position: 0, exports: 0, droppedSpans: 0 };
      const update = (change: Partial<TelemetryStatus>) => (status = { ...status, ...change });
      let started: PluginStartContext | undefined;
      let since = now();

      async function read() {
        const head = audit.head().seq;
        for (let batch = 0; batch < MAX_BATCHES && status.position < head; batch++) {
          const events = await readEvents(audit.logDirectory, {
            afterSeq: status.position,
            limit: BATCH,
          });
          const fresh = events.filter((event) => event.seq <= head);
          if (!fresh.length) break;
          for (const event of fresh) recorder.observe(event);
          update({ position: fresh.at(-1)!.seq });
        }
      }

      async function post(host: PluginStartContext, path: string, body: unknown) {
        const response = await host.ports.network.client(TELEMETRY_DESTINATION).fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          redirect: 'error',
        });
        if (!response.ok) throw new Error(`The collector returned ${response.status} to ${path}`);
      }

      async function cycle() {
        const host = started;
        if (!host) return;
        try {
          await read();
          const at = now();
          await post(
            host,
            '/v1/metrics',
            metricsRequest(resource, recorder.metrics(), await backlog(host), {
              start: since,
              now: at,
            }),
          );
          const spans = recorder.takeSpans();
          if (spans.length)
            await post(host, '/v1/traces', tracesRequest(resource, spans)).catch((error) => {
              recorder.restore(spans);
              throw error;
            });
          update({ exports: status.exports + 1, lastExport: at, lastError: undefined });
        } catch (error) {
          update({ lastError: message(error) });
        } finally {
          update({ droppedSpans: recorder.dropped() });
        }
      }

      let cycles: Promise<void> = Promise.resolve();
      const flush = () => (cycles = cycles.then(cycle));
      const service: TelemetryService = { status: () => status, flush };
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stopped = false;
      const schedule = () => {
        if (stopped) return;
        timer = setTimeout(() => void flush().finally(schedule), options.intervalMs ?? 60_000);
      };
      const stop = async () => {
        stopped = true;
        clearTimeout(timer);
        await cycles;
      };
      return {
        // Exports go only through a provided network port, never the kernel default.
        needs: ['network'],
        service,
        async start(host) {
          // Counting starts now: earlier events are in the audit log, not in these metrics.
          since = now();
          update({ position: audit.head().seq });
          const pending = await host.application.pendingEffects(hostContext(host.workspaceId), {
            limit: 10_000,
            includeHeld: true,
          });
          for (const effect of pending) recorder.pending(effect);
          started = host;
          schedule();
          return [{ stop }];
        },
        describe: () => ({ destination: TELEMETRY_DESTINATION, position: status.position }),
        close: stop,
      };
    },
  });
}

export const telemetryPlugin = createTelemetryPlugin();

import { createHash } from 'node:crypto';
import type { AuditEvent } from '@agent-native/contracts';

/**
 * Every attribute a metric or span may carry. Each value is a catalog operation ID, an outbox
 * target ID, a harness ID, an error code or one of a fixed set of states, so nothing taken from
 * a record, an input, a principal or a resource ID can reach an exported attribute.
 */
export interface Attributes {
  readonly 'agent_native.operation'?: string;
  readonly 'agent_native.outcome'?: string;
  readonly 'agent_native.channel'?: string;
  readonly 'agent_native.target'?: string;
  readonly 'agent_native.effect.status'?: string;
  readonly 'agent_native.attempt.result'?: string;
  readonly 'agent_native.outbox.state'?: string;
  readonly 'agent_native.harness'?: string;
  readonly 'agent_native.run.state'?: string;
  readonly 'error.type'?: string;
}

export interface CounterPoint {
  readonly attributes: Attributes;
  value: number;
}
export interface HistogramPoint {
  readonly attributes: Attributes;
  count: number;
  sum: number;
  min: number;
  max: number;
  readonly buckets: number[];
}
export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  /** OTLP span kind: 1 internal, 2 server. */
  readonly kind: 1 | 2;
  readonly start: number;
  readonly end: number;
  readonly attributes: Attributes;
  readonly error: boolean;
}

/** Bucket bounds in milliseconds, from a fast command to an effect held for an hour. */
export const durationBounds = [
  1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 300_000, 900_000,
  3_600_000,
];

const commandOutcomes: Record<string, string> = {
  'command.committed': 'committed',
  'command.replayed': 'replayed',
  'command.recovered': 'recovered',
  'command.aborted': 'aborted',
  'command.failed': 'failed',
  'command.denied': 'denied',
};
const effectStates = new Set(['accepted', 'rejected', 'cancelled']);
const runStates = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
/** Error codes are upper-case identifiers; anything else is reported as `OTHER`. */
const code = (value: unknown) =>
  typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : 'OTHER';
const identifier = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
    ? value
    : 'unknown';
const hex = (seed: string, length: number) =>
  createHash('sha256').update(seed).digest('hex').slice(0, length);
/** Trace and span IDs are digests, so the correlation and run IDs themselves never leave. */
const traceOf = (seed: string) => hex(`trace:${seed}`, 32);
const spanOf = (seed: string) => hex(`span:${seed}`, 16);

class Counter {
  readonly points = new Map<string, CounterPoint>();
  add(attributes: Attributes, value = 1) {
    const key = JSON.stringify(attributes);
    const point = this.points.get(key) ?? { attributes, value: 0 };
    point.value += value;
    this.points.set(key, point);
  }
}

class Histogram {
  readonly points = new Map<string, HistogramPoint>();
  record(attributes: Attributes, value: number) {
    const key = JSON.stringify(attributes);
    let point = this.points.get(key);
    if (!point) {
      point = {
        attributes,
        count: 0,
        sum: 0,
        min: value,
        max: value,
        buckets: new Array<number>(durationBounds.length + 1).fill(0),
      };
      this.points.set(key, point);
    }
    point.count++;
    point.sum += value;
    point.min = Math.min(point.min, value);
    point.max = Math.max(point.max, value);
    const bucket = durationBounds.findIndex((bound) => value <= bound);
    point.buckets[bucket === -1 ? durationBounds.length : bucket]!++;
  }
}

/** A map that forgets its oldest entry past `limit`, so a lost end event cannot grow memory. */
class Bounded<V> extends Map<string, V> {
  constructor(private readonly limit: number) {
    super();
  }
  override set(key: string, value: V) {
    if (!this.has(key) && this.size >= this.limit) this.delete(this.keys().next().value!);
    return super.set(key, value);
  }
}

export interface RecorderOptions {
  /** Spans kept for the next export; the oldest are dropped past this. 2,048 by default. */
  readonly maxSpans?: number;
  /** Commands and effects remembered while waiting for their end. 10,000 by default. */
  readonly maxOpen?: number;
}

/**
 * Turns audit events into cumulative metrics and finished spans. It reads only kinds, outcomes,
 * operation IDs, channels, reason codes, outbox targets, harness IDs, timestamps and the IDs it
 * hashes into trace IDs. It never reads `resources`, `inputDigest`, the actor's principal or
 * any `data` field besides the effect ID, target, status and run harness, state and duration.
 */
export function createRecorder(options: RecorderOptions = {}) {
  const maxSpans = options.maxSpans ?? 2_048;
  const maxOpen = options.maxOpen ?? 10_000;
  const commands = new Counter();
  const commandDuration = new Histogram();
  const deliveries = new Counter();
  const deliveryDuration = new Histogram();
  const attempts = new Counter();
  const runs = new Counter();
  const runDuration = new Histogram();
  const accepted = new Bounded<number>(maxOpen);
  const effects = new Bounded<{ at: number; traceId: string; parentSpanId?: string }>(maxOpen);
  let spans: Span[] = [];
  let dropped = 0;

  const span = (value: Span) => {
    spans.push(value);
    if (spans.length > maxSpans) {
      dropped += spans.length - maxSpans;
      spans = spans.slice(-maxSpans);
    }
  };
  /** A command's trace: its run's when an agent issued it, otherwise its own. */
  const commandTrace = (event: AuditEvent) => {
    const runId = event.actor?.runId;
    const correlation = event.correlationId ?? `seq:${event.seq}`;
    return {
      traceId: runId ? traceOf(`run:${runId}`) : traceOf(`command:${correlation}`),
      spanId: spanOf(`command:${correlation}`),
      ...(runId ? { parentSpanId: spanOf(`run:${runId}`) } : {}),
    };
  };

  function command(event: AuditEvent, outcome: string) {
    const operation = identifier(event.operation);
    const failed = outcome === 'failed' || outcome === 'denied' || outcome === 'aborted';
    const attributes: Attributes = {
      'agent_native.operation': operation,
      'agent_native.outcome': outcome,
      ...(event.actor?.via ? { 'agent_native.channel': identifier(event.actor.via) } : {}),
      ...(failed && event.reason ? { 'error.type': code(event.reason) } : {}),
    };
    commands.add(attributes);
    const started = event.correlationId ? accepted.get(event.correlationId) : undefined;
    if (event.correlationId) accepted.delete(event.correlationId);
    if (started !== undefined)
      commandDuration.record(
        { 'agent_native.operation': operation, 'agent_native.outcome': outcome },
        Math.max(0, event.at - started),
      );
    span({
      ...commandTrace(event),
      name: operation,
      kind: 2,
      start: started ?? event.at,
      end: event.at,
      attributes,
      error: failed,
    });
  }

  function effect(event: AuditEvent) {
    const data = event.data ?? {};
    const id = typeof data.effectId === 'string' ? data.effectId : undefined;
    const target = identifier(data.target);
    if (!id) return;
    if (event.kind === 'effect.enqueued') {
      const trace = commandTrace(event);
      effects.set(id, { at: event.at, traceId: trace.traceId, parentSpanId: trace.spanId });
    } else if (event.kind === 'effect.completed') {
      const status = effectStates.has(String(data.status)) ? String(data.status) : 'unknown';
      const attributes: Attributes = {
        'agent_native.target': target,
        'agent_native.effect.status': status,
      };
      deliveries.add(attributes);
      const open = effects.get(id);
      effects.delete(id);
      if (!open) return;
      deliveryDuration.record(attributes, Math.max(0, event.at - open.at));
      span({
        traceId: open.traceId,
        spanId: spanOf(`effect:${id}`),
        ...(open.parentSpanId ? { parentSpanId: open.parentSpanId } : {}),
        name: `deliver ${target}`,
        kind: 1,
        start: open.at,
        end: event.at,
        attributes,
        error: status !== 'accepted',
      });
    } else {
      // `effect.attempted` or `effect.held`: a delivery that did not complete this time.
      const result =
        event.kind === 'effect.held'
          ? 'held'
          : event.outcome === 'denied'
            ? 'superseded'
            : data.acknowledged === true
              ? 'acknowledged'
              : 'retry';
      attempts.add({ 'agent_native.target': target, 'agent_native.attempt.result': result });
    }
  }

  function run(event: AuditEvent) {
    const runId = event.actor?.runId;
    const data = event.data ?? {};
    const state = runStates.has(String(data.state)) ? String(data.state) : 'unknown';
    const attributes: Attributes = {
      'agent_native.harness': identifier(data.harness),
      'agent_native.run.state': state,
      ...(state !== 'succeeded' && event.reason ? { 'error.type': code(event.reason) } : {}),
    };
    runs.add(attributes);
    const duration = typeof data.durationMs === 'number' ? Math.max(0, data.durationMs) : 0;
    runDuration.record(
      {
        'agent_native.harness': attributes['agent_native.harness'],
        'agent_native.run.state': state,
      },
      duration,
    );
    if (!runId) return;
    span({
      traceId: traceOf(`run:${runId}`),
      spanId: spanOf(`run:${runId}`),
      name: 'run',
      kind: 1,
      start: event.at - duration,
      end: event.at,
      attributes,
      error: state !== 'succeeded',
    });
  }

  return {
    /** Take one audit event; kinds it does not measure are ignored. */
    observe(event: AuditEvent) {
      if (event.kind === 'command.accepted') {
        if (event.correlationId) accepted.set(event.correlationId, event.at);
      } else if (event.kind in commandOutcomes) command(event, commandOutcomes[event.kind]!);
      else if (event.kind.startsWith('effect.')) effect(event);
      else if (event.kind === 'run.ended') run(event);
    },
    /** An effect pending before the recorder started, so its delivery time is still measured. */
    pending(effect: { readonly id: string; readonly createdAt: number }) {
      if (!effects.has(effect.id))
        effects.set(effect.id, {
          at: effect.createdAt,
          traceId: traceOf(`effect:${effect.id}`),
        });
    },
    metrics: () => ({
      commands: [...commands.points.values()],
      commandDuration: [...commandDuration.points.values()],
      deliveries: [...deliveries.points.values()],
      deliveryDuration: [...deliveryDuration.points.values()],
      attempts: [...attempts.points.values()],
      runs: [...runs.points.values()],
      runDuration: [...runDuration.points.values()],
    }),
    /** Remove and return the finished spans; `restore` puts them back after a failed export. */
    takeSpans() {
      const taken = spans;
      spans = [];
      return taken;
    },
    restore(taken: readonly Span[]) {
      spans = [...taken, ...spans];
      if (spans.length > maxSpans) {
        dropped += spans.length - maxSpans;
        spans = spans.slice(-maxSpans);
      }
    },
    dropped: () => dropped,
  };
}

export type Recorder = ReturnType<typeof createRecorder>;
export type RecordedMetrics = ReturnType<Recorder['metrics']>;

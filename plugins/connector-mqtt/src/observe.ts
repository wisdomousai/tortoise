import { createHash } from 'node:crypto';
import {
  Debouncer,
  createObserver,
  debounceReadings,
  type ObservationBase,
  type Reading,
} from '@tortoise/observation';
import type { CommandResult, ExecutionContext, Invocation } from '@tortoise/runtime';
import { createMqttSubscriber, type MqttSubscriberOptions } from './client';
import { decodePayload, parseTopic, SparkplugState, type MetricValue } from './sparkplug';

interface FieldBase {
  /** The reading's field ID, as the ingest command knows it. */
  readonly id: string;
  /** Consecutive samples that must agree before a value counts. Default 1. */
  readonly stableReads?: number;
}
/** One metric of a Sparkplug B edge node, or of a device behind it. */
export interface SparkplugField extends FieldBase {
  readonly sparkplug: {
    readonly group: string;
    readonly node: string;
    readonly device?: string;
    readonly metric: string;
  };
}
/** The last message on a plain topic: JSON, read at `pointer` when given, else the text. */
export interface TopicField extends FieldBase {
  readonly topic: string;
  readonly pointer?: string;
}
export type MqttField = SparkplugField | TopicField;

export interface MqttObservation extends ObservationBase {
  readonly source: 'mqtt';
  readonly destination: string;
}

export interface MqttObserverOptions {
  readonly subscriber: Omit<MqttSubscriberOptions, 'filters' | 'onMessage' | 'onConnection'>;
  readonly fields: readonly MqttField[];
  readonly application: {
    invokeRaw(request: Invocation, context: ExecutionContext): Promise<CommandResult>;
  };
  /** The observing principal, granted the ingest operation only. */
  readonly context: ExecutionContext;
  readonly ingestOperation: string;
  readonly toInput?: (observation: MqttObservation) => unknown;
  readonly heartbeatMs?: number;
  readonly now?: () => number;
}

const isSparkplug = (field: MqttField): field is SparkplugField => 'sparkplug' in field;

function pointerOf(value: unknown, pointer: string): unknown {
  let current = value;
  for (const raw of pointer.split('/').slice(1)) {
    const step = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, step))
      return undefined;
    current = (current as Record<string, unknown>)[step];
  }
  return current;
}

function scalar(value: unknown): MetricValue | undefined {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
    return value as MetricValue;
  return undefined;
}

/** The subscriptions the fields need: one per edge node, one per plain topic. */
export function filtersFor(fields: readonly MqttField[]): string[] {
  const filters = new Set<string>();
  for (const field of fields)
    filters.add(
      isSparkplug(field)
        ? `spBv1.0/${field.sparkplug.group}/+/${field.sparkplug.node}/#`
        : field.topic,
    );
  return [...filters];
}

/**
 * Observe MQTT values and submit them through an ingest command. Read-only: it subscribes and
 * never publishes. Each sample reads the fields' last values; a value that is not current (the
 * edge node died or lost sequence, or the broker connection dropped) is read with confidence 0,
 * so the debouncer marks it `uncertain` and the domain does not take it as fact.
 */
export function createMqttObserver(options: MqttObserverOptions) {
  const state = new SparkplugState();
  const topics = new Map<string, { payload: Uint8Array; at: number }>();
  const now = options.now ?? Date.now;
  let connected = false;
  const subscriber = createMqttSubscriber({
    ...options.subscriber,
    filters: filtersFor(options.fields),
    onConnection(value) {
      connected = value;
      state.setConnected(value);
    },
    onMessage(message) {
      const topic = parseTopic(message.topic);
      if (topic) state.apply(topic, decodePayload(message.payload));
      else topics.set(message.topic, { payload: message.payload, at: now() });
    },
  });
  const debouncer = new Debouncer();
  const byId = new Map(options.fields.map((field) => [field.id, field]));

  function read(field: MqttField): { value: MetricValue; current: boolean } | undefined {
    if (isSparkplug(field)) {
      const { group, node, device, metric } = field.sparkplug;
      return state.read(group, node, device, metric);
    }
    const last = topics.get(field.topic);
    if (!last) return undefined;
    const text = new TextDecoder().decode(last.payload);
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON: the text itself is the value.
    }
    const value = scalar(field.pointer ? pointerOf(parsed, field.pointer) : parsed);
    return value === undefined ? undefined : { value, current: connected };
  }

  const observer = createObserver<MqttObservation>({
    source: `mqtt:${options.subscriber.destination}`,
    application: options.application,
    context: options.context,
    ingestOperation: options.ingestOperation,
    ...(options.toInput ? { toInput: options.toInput } : {}),
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
    async sample() {
      const observedAt = now();
      const values = options.fields.map((field) => [field.id, read(field)] as const);
      const frameDigest = createHash('sha256').update(JSON.stringify(values)).digest('hex');
      const readings: Reading[] = [];
      for (const [id, found] of values) {
        if (!found) continue;
        const field = byId.get(id)!;
        readings.push({
          field: id,
          value: found.value,
          confidence: found.current ? 1 : 0,
          extractor: isSparkplug(field) ? 'sparkplug-b' : 'mqtt-topic',
          observedAt,
          frameDigest,
        });
      }
      return {
        source: 'mqtt',
        destination: options.subscriber.destination,
        observedAt,
        frameDigest,
        readings: debounceReadings(debouncer, readings, (id) => {
          const field = byId.get(id);
          return field
            ? { stableReads: field.stableReads ?? 1, minConfidence: 1, declared: { id } }
            : undefined;
        }),
      };
    },
  });

  return {
    runOnce: observer.runOnce,
    get connected() {
      return connected;
    },
    /** Connect, then sample every `intervalMs`. */
    start(intervalMs: number, onError?: (error: unknown) => void) {
      subscriber.start();
      observer.start(intervalMs, onError);
    },
    async stop() {
      await observer.stop();
      await subscriber.stop();
    },
  };
}

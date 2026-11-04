import { createHash } from 'node:crypto';
import {
  Debouncer,
  createObserver,
  debounceReadings,
  type ObservationBase,
  type Reading,
} from '@tortoise/observation';
import type { CommandReceipt, ExecutionContext, Invocation } from '@tortoise/runtime';
import { OpcUaClient, type OpcUaClientOptions } from './client';
import { isBad, isUncertain, parseNodeId, type NodeId, type Scalar } from './types';

export interface OpcUaField {
  /** The reading's field ID, as the ingest command knows it. */
  readonly id: string;
  /** Node ID text, `ns=2;s=Press.Temperature`. */
  readonly node: string;
  readonly stableReads?: number;
}

export interface OpcUaObservation extends ObservationBase {
  readonly source: 'opcua';
  readonly destination: string;
}

export interface OpcUaObserverOptions {
  readonly client: OpcUaClientOptions;
  readonly fields: readonly OpcUaField[];
  readonly application: {
    invokeRaw(request: Invocation, context: ExecutionContext): Promise<CommandReceipt>;
  };
  /** The observing principal, granted the ingest operation only. */
  readonly context: ExecutionContext;
  readonly ingestOperation: string;
  readonly toInput?: (observation: OpcUaObservation) => unknown;
  readonly heartbeatMs?: number;
  readonly now?: () => number;
  readonly onError?: (error: unknown) => void;
}

/** Confidence from the value's status: Good reads as fact, Uncertain and Bad do not. */
const confidenceOf = (status: number) => (isBad(status) ? 0 : isUncertain(status) ? 0.5 : 1);

/**
 * Poll OPC UA node values with the Read service and submit them through an ingest command.
 * Read-only. A lost connection is reopened on the next sample; until then each field keeps its
 * last value with confidence 0, so the debouncer marks it `uncertain` instead of dropping it, and the
 * domain sees that it is not current.
 */
export function createOpcUaObserver(options: OpcUaObserverOptions) {
  const nodes: NodeId[] = options.fields.map((field) => parseNodeId(field.node));
  const byId = new Map(options.fields.map((field) => [field.id, field]));
  const debouncer = new Debouncer();
  const last = new Map<string, Scalar>();
  const now = options.now ?? Date.now;
  let client: OpcUaClient | undefined;

  async function values() {
    if (!client?.connected) {
      await client?.close().catch(() => undefined);
      client = new OpcUaClient(options.client);
      await client.connect();
    }
    return client.read(nodes);
  }

  const observer = createObserver<OpcUaObservation>({
    source: `opcua:${options.client.destination}`,
    application: options.application,
    context: options.context,
    ingestOperation: options.ingestOperation,
    ...(options.toInput ? { toInput: options.toInput } : {}),
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
    async sample() {
      const observedAt = now();
      const read = await values().catch((error: unknown) => {
        options.onError?.(error);
        return undefined;
      });
      const readings: Reading[] = [];
      options.fields.forEach((field, index) => {
        const data = read?.[index];
        if (data && data.value && 'value' in data.value && !isBad(data.status))
          last.set(field.id, data.value.value);
        const value =
          data && !isBad(data.status) && data.value && 'value' in data.value
            ? data.value.value
            : last.get(field.id);
        if (value === undefined) return;
        readings.push({
          field: field.id,
          value,
          confidence: data ? confidenceOf(data.status) : 0,
          extractor: 'opcua-read',
          observedAt,
          frameDigest: '',
        });
      });
      const frameDigest = createHash('sha256')
        .update(JSON.stringify(readings.map((r) => [r.field, r.value, r.confidence])))
        .digest('hex');
      return {
        source: 'opcua',
        destination: options.client.destination,
        observedAt,
        frameDigest,
        readings: debounceReadings(
          debouncer,
          readings.map((reading) => ({ ...reading, frameDigest })),
          (id) => {
            const field = byId.get(id);
            return field
              ? { stableReads: field.stableReads ?? 1, minConfidence: 1, declared: { id } }
              : undefined;
          },
        ),
      };
    },
  });

  return {
    runOnce: observer.runOnce,
    start: observer.start,
    async stop() {
      await observer.stop();
      await client?.close().catch(() => undefined);
    },
  };
}

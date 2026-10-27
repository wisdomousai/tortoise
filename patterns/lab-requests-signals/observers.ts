import type { NetworkPort } from '@agent-native/host/plugin';
import type { ObservationBase } from '@agent-native/observation';
import type { CommandReceipt, ExecutionContext, Invocation } from '@agent-native/runtime';
import { createMqttObserver } from '@agent-native/connector-mqtt/observe';
import { createOpcUaObserver } from '@agent-native/connector-opcua/observe';
import { CHAMBER_BROKER, CHAMBER_GATEWAY, chamberOperations } from './contracts';
import { OBSERVER_PRINCIPAL, fieldId, type ChamberDefinition } from './domain';

export interface ChamberObserverOptions {
  readonly application: {
    invokeRaw(request: Invocation, context: ExecutionContext): Promise<CommandReceipt>;
  };
  readonly workspaceId: string;
  readonly network: NetworkPort;
  readonly chambers: readonly ChamberDefinition[];
  /** What the gateway expects to be told; the address itself comes from the site policy. */
  readonly endpointUrl?: string;
  readonly heartbeatMs?: number;
  readonly retryMs?: number;
}

/** The ingest input: the gated readings without their provenance, which the record does not keep. */
const toInput =
  (source: 'opcua' | 'mqtt') =>
  ({ observedAt, readings }: ObservationBase) => ({
    source,
    observedAt,
    readings: readings.map(({ field, value, status }) => ({ field, value, status })),
  });

/**
 * Both chamber observers. Temperature comes from the chamber controllers over OPC UA and needs
 * two equal reads to count; humidity comes from Sparkplug B edge nodes. Both submit through
 * `chamber.reading.ingest` as the observer principal, whose grant names that command alone, so
 * a compromised gateway or broker can do nothing else.
 */
export function createChamberObservers(options: ChamberObserverOptions) {
  const context: ExecutionContext = {
    workspaceId: options.workspaceId,
    principalId: OBSERVER_PRINCIPAL,
    grant: { operations: [chamberOperations.readingIngest.id] },
  };
  const shared = {
    application: options.application,
    context,
    ingestOperation: chamberOperations.readingIngest.id,
    ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
  };
  const temperature = createOpcUaObserver({
    ...shared,
    client: {
      network: options.network,
      destination: CHAMBER_GATEWAY,
      endpointUrl: options.endpointUrl ?? 'opc.tcp://chamber-gateway:4840',
    },
    fields: options.chambers.map((chamber) => ({
      id: fieldId(chamber.id, 'temperature'),
      node: chamber.temperatureNode,
      stableReads: 2,
    })),
    toInput: toInput('opcua'),
  });
  const humidity = createMqttObserver({
    ...shared,
    subscriber: {
      network: options.network,
      destination: CHAMBER_BROKER,
      clientId: `lab-chamber-observer-${options.workspaceId}`,
      ...(options.retryMs === undefined ? {} : { retryMs: options.retryMs }),
    },
    fields: options.chambers.map((chamber) => ({
      id: fieldId(chamber.id, 'humidity'),
      sparkplug: chamber.humidity,
    })),
    toInput: toInput('mqtt'),
  });
  return {
    context,
    temperature,
    humidity,
    start(intervalMs: number, onError: (scope: string, error: unknown) => void) {
      temperature.start(intervalMs, (error) => onError('chamber-gateway', error));
      humidity.start(intervalMs, (error) => onError('chamber-broker', error));
    },
    async stop() {
      await Promise.all([temperature.stop(), humidity.stop()]);
    },
  };
}

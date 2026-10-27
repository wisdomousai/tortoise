import { readFields, asView, type Field } from './protobuf';

/** Sparkplug B metric data types (specification 3.0, section 6.4.16). */
export const DataType = {
  Int8: 1,
  Int16: 2,
  Int32: 3,
  Int64: 4,
  UInt8: 5,
  UInt16: 6,
  UInt32: 7,
  UInt64: 8,
  Float: 9,
  Double: 10,
  Boolean: 11,
  String: 12,
  DateTime: 13,
  Text: 14,
  UUID: 15,
} as const;

export type MetricValue = string | number | boolean | null;

export interface Metric {
  readonly name?: string;
  readonly alias?: bigint;
  readonly timestamp?: number;
  readonly datatype?: number;
  /** Undefined for a data type this reader does not support (data sets, templates, bytes). */
  readonly value?: MetricValue;
  readonly historical?: boolean;
}

export interface SparkplugPayload {
  readonly timestamp?: number;
  readonly seq?: number;
  readonly metrics: readonly Metric[];
}

const big = (field: Field) => field.value as bigint;
const raw = (field: Field) => field.value as Uint8Array;
/** A 64-bit integer as a number when exact, else its decimal text, so no digit is lost. */
const exact = (value: bigint): number | string =>
  value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(value)
    : value.toString();

function metricOf(bytes: Uint8Array): Metric {
  let name: string | undefined;
  let alias: bigint | undefined;
  let timestamp: number | undefined;
  let datatype: number | undefined;
  let historical = false;
  let isNull = false;
  let int: bigint | undefined;
  let long: bigint | undefined;
  let float: number | undefined;
  let double: number | undefined;
  let bool: boolean | undefined;
  let text: string | undefined;
  for (const field of readFields(bytes)) {
    switch (field.number) {
      case 1:
        name = new TextDecoder().decode(raw(field));
        break;
      case 2:
        alias = big(field);
        break;
      case 3:
        timestamp = Number(big(field));
        break;
      case 4:
        datatype = Number(big(field));
        break;
      case 5:
        historical = big(field) !== 0n;
        break;
      case 7:
        isNull = big(field) !== 0n;
        break;
      case 10:
        int = big(field);
        break;
      case 11:
        long = big(field);
        break;
      case 12:
        float = asView(raw(field)).getFloat32(0, true);
        break;
      case 13:
        double = asView(raw(field)).getFloat64(0, true);
        break;
      case 14:
        bool = big(field) !== 0n;
        break;
      case 15:
        text = new TextDecoder().decode(raw(field));
        break;
    }
  }
  let value: MetricValue | undefined;
  if (isNull) value = null;
  else
    switch (datatype) {
      // Signed values are sent in the unsigned field as two's complement of 32 bits.
      case DataType.Int8:
      case DataType.Int16:
      case DataType.Int32:
        value = int === undefined ? undefined : Number(BigInt.asIntN(32, int));
        break;
      case DataType.UInt8:
      case DataType.UInt16:
      case DataType.UInt32:
        value = int === undefined ? undefined : Number(BigInt.asUintN(32, int));
        break;
      case DataType.Int64:
        value = long === undefined ? undefined : exact(BigInt.asIntN(64, long));
        break;
      case DataType.UInt64:
      case DataType.DateTime:
        value = long === undefined ? undefined : exact(BigInt.asUintN(64, long));
        break;
      case DataType.Float:
        value = float;
        break;
      case DataType.Double:
        value = double;
        break;
      case DataType.Boolean:
        value = bool;
        break;
      case DataType.String:
      case DataType.Text:
      case DataType.UUID:
        value = text;
        break;
    }
  return {
    ...(name !== undefined ? { name } : {}),
    ...(alias !== undefined ? { alias } : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(datatype !== undefined ? { datatype } : {}),
    ...(value !== undefined ? { value } : {}),
    ...(historical ? { historical } : {}),
  };
}

export function decodePayload(bytes: Uint8Array): SparkplugPayload {
  let timestamp: number | undefined;
  let seq: number | undefined;
  const metrics: Metric[] = [];
  for (const field of readFields(bytes)) {
    if (field.number === 1 && field.wire === 0) timestamp = Number(big(field));
    else if (field.number === 2 && field.wire === 2) metrics.push(metricOf(raw(field)));
    else if (field.number === 3 && field.wire === 0) seq = Number(big(field));
  }
  return {
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(seq !== undefined ? { seq } : {}),
    metrics,
  };
}

/** `spBv1.0/<group>/<type>/<edge node>[/<device>]`. */
export interface SparkplugTopic {
  readonly group: string;
  readonly type: 'NBIRTH' | 'NDATA' | 'NDEATH' | 'DBIRTH' | 'DDATA' | 'DDEATH' | 'NCMD' | 'DCMD';
  readonly node: string;
  readonly device?: string;
}
const types = new Set(['NBIRTH', 'NDATA', 'NDEATH', 'DBIRTH', 'DDATA', 'DDEATH', 'NCMD', 'DCMD']);
export function parseTopic(topic: string): SparkplugTopic | undefined {
  const parts = topic.split('/');
  if (parts[0] !== 'spBv1.0' || parts.length < 4 || parts.length > 5) return undefined;
  const [, group, type, node, device] = parts as [string, string, string, string, string?];
  if (!types.has(type)) return undefined;
  return {
    group,
    type: type as SparkplugTopic['type'],
    node,
    ...(device !== undefined ? { device } : {}),
  };
}

/** The last value of one metric and whether it can still be trusted. */
export interface MetricState {
  readonly value: MetricValue;
  readonly timestamp?: number;
  /** False after a death, a sequence gap or a lost connection, until the next birth. */
  readonly current: boolean;
}

interface Scope {
  online: boolean;
  metrics: Map<string, { value: MetricValue; timestamp?: number }>;
}
interface NodeState extends Scope {
  seq?: number;
  inSync: boolean;
  bdSeq?: number | string;
  /** Aliases are unique per edge node, across the node and its devices. */
  aliases: Map<bigint, string>;
  devices: Map<string, Scope>;
}

const key = (group: string, node: string) => `${group}/${node}`;

/**
 * Sparkplug B host state, as a read-only consumer keeps it: births define the metric names
 * and aliases, data updates them, a death or a sequence gap marks them not current. A node that
 * lost sequence stays not current until it publishes a new birth; this consumer never asks for
 * one, because sending a rebirth command would be a write.
 */
export class SparkplugState {
  private readonly nodes = new Map<string, NodeState>();
  private connected = true;

  /** The broker connection; while it is down nothing is current. */
  setConnected(connected: boolean) {
    this.connected = connected;
  }

  apply(topic: SparkplugTopic, payload: SparkplugPayload) {
    const id = key(topic.group, topic.node);
    if (topic.type === 'NBIRTH') {
      const bdSeq = payload.metrics.find((metric) => metric.name === 'bdSeq')?.value;
      const node: NodeState = {
        online: true,
        seq: payload.seq,
        inSync: true,
        ...(bdSeq !== undefined && bdSeq !== null && typeof bdSeq !== 'boolean' ? { bdSeq } : {}),
        aliases: new Map(),
        metrics: new Map(),
        devices: new Map(),
      };
      this.nodes.set(id, node);
      this.store(node, node, payload.metrics, true);
      return;
    }
    const node = this.nodes.get(id);
    if (!node) return;
    if (topic.type === 'NDEATH') {
      // A death certificate from an earlier session (its bdSeq differs) must not end this one.
      const bdSeq = payload.metrics.find((metric) => metric.name === 'bdSeq')?.value;
      if (node.bdSeq !== undefined && bdSeq !== undefined && bdSeq !== node.bdSeq) return;
      node.online = false;
      return;
    }
    if (topic.type === 'NCMD' || topic.type === 'DCMD') return;
    if (payload.seq !== undefined && node.seq !== undefined) {
      if (payload.seq !== (node.seq + 1) % 256) node.inSync = false;
    }
    if (payload.seq !== undefined) node.seq = payload.seq;
    if (topic.type === 'NDATA') return this.store(node, node, payload.metrics, false);
    const device = topic.device!;
    if (topic.type === 'DBIRTH') {
      const scope: Scope = { online: true, metrics: new Map() };
      node.devices.set(device, scope);
      return this.store(node, scope, payload.metrics, true);
    }
    const scope = node.devices.get(device);
    if (!scope) return;
    if (topic.type === 'DDEATH') scope.online = false;
    else this.store(node, scope, payload.metrics, false);
  }

  private store(node: NodeState, scope: Scope, metrics: readonly Metric[], birth: boolean) {
    for (const metric of metrics) {
      if (birth && metric.name !== undefined && metric.alias !== undefined)
        node.aliases.set(metric.alias, metric.name);
      const name =
        metric.name ?? (metric.alias !== undefined ? node.aliases.get(metric.alias) : undefined);
      // Historical values are backfill, not the present; an unknown alias names nothing.
      if (name === undefined || metric.historical || metric.value === undefined) continue;
      if (!birth && !scope.metrics.has(name)) continue;
      scope.metrics.set(name, {
        value: metric.value,
        ...(metric.timestamp !== undefined ? { timestamp: metric.timestamp } : {}),
      });
    }
  }

  /** The metric's last value, or undefined when no birth defined it. */
  read(
    group: string,
    node: string,
    device: string | undefined,
    metric: string,
  ): MetricState | undefined {
    const state = this.nodes.get(key(group, node));
    if (!state) return undefined;
    const scope = device === undefined ? state : state.devices.get(device);
    const last = scope?.metrics.get(metric);
    if (!scope || !last) return undefined;
    return {
      ...last,
      current: this.connected && state.online && state.inSync && scope.online,
    };
  }
}

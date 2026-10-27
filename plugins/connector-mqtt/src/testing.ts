import { PacketReader, PacketType, decodePublish, encodePublish } from './packets';
import { FieldWriter } from './protobuf';
import { DataType, type MetricValue } from './sparkplug';

export interface TestMetric {
  readonly name?: string;
  readonly alias?: number;
  readonly datatype: number;
  readonly value: MetricValue | bigint;
  readonly historical?: boolean;
}

/** Encode a Sparkplug B payload, as an edge node would publish it. */
export function encodeSparkplug(payload: {
  readonly seq?: number;
  readonly timestamp?: number;
  readonly metrics: readonly TestMetric[];
}): Uint8Array {
  const writer = new FieldWriter();
  if (payload.timestamp !== undefined) writer.uint(1, payload.timestamp);
  for (const metric of payload.metrics) {
    const m = new FieldWriter();
    if (metric.name !== undefined) m.string(1, metric.name);
    if (metric.alias !== undefined) m.uint(2, metric.alias);
    m.uint(4, metric.datatype);
    if (metric.historical) m.bool(5, true);
    const value = metric.value;
    if (value === null) m.bool(7, true);
    else
      switch (metric.datatype) {
        case DataType.Int8:
        case DataType.Int16:
        case DataType.Int32:
        case DataType.UInt8:
        case DataType.UInt16:
        case DataType.UInt32:
          m.uint(10, BigInt.asUintN(32, BigInt(value as number)));
          break;
        case DataType.Int64:
        case DataType.UInt64:
        case DataType.DateTime:
          m.uint(11, BigInt.asUintN(64, BigInt(value as number | bigint)));
          break;
        case DataType.Float:
          m.float(12, value as number);
          break;
        case DataType.Double:
          m.double(13, value as number);
          break;
        case DataType.Boolean:
          m.bool(14, value as boolean);
          break;
        default:
          m.string(15, String(value));
      }
    writer.bytesField(2, m.finish());
  }
  if (payload.seq !== undefined) writer.uint(3, payload.seq);
  return writer.finish();
}

/** Whether an MQTT topic filter (`+`, `#`) matches a topic. */
export function matches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let index = 0; index < f.length; index++) {
    if (f[index] === '#') return true;
    if (index >= t.length) return false;
    if (f[index] !== '+' && f[index] !== t[index]) return false;
  }
  return f.length === t.length;
}

type Client = { socket: Bun.Socket<{ reader: PacketReader; filters: string[] }> };

/**
 * A loopback MQTT broker for tests: it accepts any client, keeps subscriptions and retained
 * messages, and forwards publishes at QoS 0. `published` records what clients published, so a
 * test can prove a read-only client sent nothing.
 */
export class FakeBroker {
  readonly published: string[] = [];
  readonly connects: { clientId: string; username?: string }[] = [];
  private readonly clients = new Set<Client>();
  private readonly retained = new Map<string, Uint8Array>();
  private listener?: Bun.TCPSocketListener<{ reader: PacketReader; filters: string[] }>;
  /** Refuse the next CONNECT with this return code. */
  refuseNext?: number;

  /** Listen on 127.0.0.1 at `port`, a free one by default; returns the port. */
  start(port = 0): number {
    this.listener = Bun.listen<{ reader: PacketReader; filters: string[] }>({
      hostname: '127.0.0.1',
      port,
      socket: {
        open: (socket) => {
          socket.data = { reader: new PacketReader(), filters: [] };
          this.clients.add({ socket });
        },
        data: (socket, chunk) => this.receive(socket, new Uint8Array(chunk)),
        close: (socket) => {
          for (const client of this.clients)
            if (client.socket === socket) this.clients.delete(client);
        },
      },
    });
    return this.listener.port;
  }

  /** Publish to every matching subscriber, as another client on the broker would. */
  publish(topic: string, payload: Uint8Array | string, options: { retain?: boolean } = {}) {
    const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
    if (options.retain) this.retained.set(topic, bytes);
    for (const { socket } of this.clients)
      if (socket.data.filters.some((filter) => matches(filter, topic)))
        socket.write(encodePublish(topic, bytes));
  }

  /** Drop every client connection, as a broker restart would. */
  disconnectAll() {
    for (const { socket } of this.clients) socket.end();
  }

  get subscribers() {
    return [...this.clients].flatMap(({ socket }) => socket.data.filters);
  }

  stop() {
    this.listener?.stop(true);
  }

  private receive(socket: Client['socket'], chunk: Uint8Array) {
    for (const packet of socket.data.reader.push(chunk)) {
      if (packet.type === PacketType.connect) {
        const body = packet.body;
        const nameLength = (body[0]! << 8) | body[1]!;
        let offset = 2 + nameLength + 1;
        const flags = body[offset]!;
        offset += 3;
        const string = () => {
          const length = (body[offset]! << 8) | body[offset + 1]!;
          const text = new TextDecoder().decode(body.subarray(offset + 2, offset + 2 + length));
          offset += 2 + length;
          return text;
        };
        const clientId = string();
        const username = flags & 0x80 ? string() : undefined;
        this.connects.push({ clientId, ...(username !== undefined ? { username } : {}) });
        const code = this.refuseNext ?? 0;
        delete this.refuseNext;
        socket.write(Uint8Array.from([PacketType.connack << 4, 2, 0, code]));
        if (code) socket.end();
      } else if (packet.type === PacketType.subscribe) {
        const body = packet.body;
        const id = [body[0]!, body[1]!];
        let offset = 2;
        const granted: number[] = [];
        while (offset < body.length) {
          const length = (body[offset]! << 8) | body[offset + 1]!;
          socket.data.filters.push(
            new TextDecoder().decode(body.subarray(offset + 2, offset + 2 + length)),
          );
          offset += 2 + length + 1;
          granted.push(0);
        }
        socket.write(
          Uint8Array.from([PacketType.suback << 4, 2 + granted.length, ...id, ...granted]),
        );
        for (const [topic, payload] of this.retained)
          if (socket.data.filters.some((filter) => matches(filter, topic)))
            socket.write(encodePublish(topic, payload));
      } else if (packet.type === PacketType.publish) {
        this.published.push(decodePublish(packet).topic);
      } else if (packet.type === PacketType.pingreq) {
        socket.write(Uint8Array.from([PacketType.pingresp << 4, 0]));
      }
    }
  }
}

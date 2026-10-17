/**
 * MQTT 3.1.1 control packets: the subset a read-only subscriber needs. Encoders build whole
 * packets; `PacketReader` cuts a byte stream into packets, however TCP splits it.
 */
export const PacketType = {
  connect: 1,
  connack: 2,
  publish: 3,
  puback: 4,
  subscribe: 8,
  suback: 9,
  pingreq: 12,
  pingresp: 13,
  disconnect: 14,
} as const;

/** The most a remaining length may encode (four length bytes). */
const maxRemaining = 268_435_455;

function remainingLength(length: number): number[] {
  if (length > maxRemaining) throw new Error('MQTT packet too large');
  const bytes: number[] = [];
  do {
    let byte = length % 128;
    length = Math.floor(length / 128);
    if (length > 0) byte |= 0x80;
    bytes.push(byte);
  } while (length > 0);
  return bytes;
}

const utf8 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 0xffff) throw new Error('MQTT string too long');
  return [bytes.length >> 8, bytes.length & 0xff, ...bytes];
};

function packet(first: number, body: readonly number[]): Uint8Array {
  return Uint8Array.from([first, ...remainingLength(body.length), ...body]);
}

export interface ConnectOptions {
  readonly clientId: string;
  readonly keepAliveSeconds: number;
  readonly username?: string;
  readonly password?: string;
}

export function encodeConnect(options: ConnectOptions): Uint8Array {
  // Clean session: a read-only observer keeps no broker-side state between connections.
  let flags = 0x02;
  if (options.username !== undefined) flags |= 0x80;
  if (options.password !== undefined) flags |= 0x40;
  const body = [
    ...utf8('MQTT'),
    4,
    flags,
    options.keepAliveSeconds >> 8,
    options.keepAliveSeconds & 0xff,
    ...utf8(options.clientId),
    ...(options.username !== undefined ? utf8(options.username) : []),
    ...(options.password !== undefined ? utf8(options.password) : []),
  ];
  return packet(PacketType.connect << 4, body);
}

export function encodeSubscribe(
  packetId: number,
  filters: readonly { topic: string; qos: 0 | 1 }[],
): Uint8Array {
  const body = [packetId >> 8, packetId & 0xff];
  for (const filter of filters) body.push(...utf8(filter.topic), filter.qos);
  return packet((PacketType.subscribe << 4) | 0x02, body);
}

export const encodePuback = (packetId: number) =>
  packet(PacketType.puback << 4, [packetId >> 8, packetId & 0xff]);
export const encodePingreq = () => packet(PacketType.pingreq << 4, []);
export const encodeDisconnect = () => packet(PacketType.disconnect << 4, []);

/** Encode a PUBLISH, for test brokers and publishers. */
export function encodePublish(
  topic: string,
  payload: Uint8Array,
  options: { qos?: 0 | 1; packetId?: number; retain?: boolean } = {},
): Uint8Array {
  const qos = options.qos ?? 0;
  const head = [...utf8(topic), ...(qos ? [options.packetId! >> 8, options.packetId! & 0xff] : [])];
  const first = (PacketType.publish << 4) | (qos << 1) | (options.retain ? 1 : 0);
  return packet(first, [...head, ...payload]);
}

export interface Packet {
  readonly type: number;
  readonly flags: number;
  readonly body: Uint8Array;
}

export interface Publish {
  readonly topic: string;
  readonly qos: number;
  readonly retain: boolean;
  readonly packetId?: number;
  readonly payload: Uint8Array;
}

export function decodePublish(packet: Packet): Publish {
  const { body, flags } = packet;
  const topicLength = (body[0]! << 8) | body[1]!;
  const topic = new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(2, 2 + topicLength));
  const qos = (flags >> 1) & 0x03;
  let offset = 2 + topicLength;
  let packetId: number | undefined;
  if (qos > 0) {
    packetId = (body[offset]! << 8) | body[offset + 1]!;
    offset += 2;
  }
  return {
    topic,
    qos,
    retain: (flags & 0x01) === 1,
    ...(packetId !== undefined ? { packetId } : {}),
    payload: body.subarray(offset),
  };
}

/** Cuts a byte stream into packets. A packet larger than `maxPacket` is refused. */
export class PacketReader {
  private buffer = new Uint8Array(0);
  constructor(private readonly maxPacket = 1 << 20) {}

  push(chunk: Uint8Array): Packet[] {
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    this.buffer = joined;
    const packets: Packet[] = [];
    for (;;) {
      if (this.buffer.length < 2) break;
      let length = 0;
      let multiplier = 1;
      let index = 1;
      let complete = false;
      for (; index < Math.min(this.buffer.length, 5); index++) {
        const byte = this.buffer[index]!;
        length += (byte & 0x7f) * multiplier;
        multiplier *= 128;
        if (!(byte & 0x80)) {
          complete = true;
          break;
        }
      }
      if (!complete) {
        if (this.buffer.length >= 5) throw new Error('Malformed MQTT remaining length');
        break;
      }
      if (length > this.maxPacket) throw new Error('MQTT packet exceeds the size limit');
      const start = index + 1;
      if (this.buffer.length < start + length) break;
      const first = this.buffer[0]!;
      packets.push({
        type: first >> 4,
        flags: first & 0x0f,
        body: this.buffer.slice(start, start + length),
      });
      this.buffer = this.buffer.slice(start + length);
    }
    return packets;
  }
}

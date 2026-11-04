import { afterEach, describe, expect, test } from 'bun:test';
import type { NetworkPort } from '@tortoise/kernel/plugin';
import type { ExecutionContext, Invocation } from '@tortoise/runtime';
import {
  DataType,
  SparkplugState,
  createMqttObserver,
  decodePayload,
  filtersFor,
  parseTopic,
} from '../src';
import { PacketReader, encodePublish } from '../src/packets';
import { FakeBroker, encodeSparkplug, matches } from '../src/testing';

/** A network port whose one `tcp` destination is the test broker, as a site policy would bind it. */
const networkTo = (port: number): NetworkPort =>
  ({
    client: () => {
      throw new Error('no http');
    },
    routedFetch: () => fetch,
    socket: (_destination: string, handler: Bun.SocketHandler) =>
      Bun.connect({ hostname: '127.0.0.1', port, socket: handler }),
  }) as unknown as NetworkPort;

const until = async (condition: () => boolean, ms = 2_000) => {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await Bun.sleep(5);
  }
};

const brokers: FakeBroker[] = [];
afterEach(() => {
  for (const broker of brokers.splice(0)) broker.stop();
});

describe('packets', () => {
  test('a packet split across chunks, and two in one chunk, are both cut correctly', () => {
    const payload = new Uint8Array(300).fill(7);
    const bytes = new Uint8Array([
      ...encodePublish('a/b', payload),
      ...encodePublish('c', new Uint8Array([1])),
    ]);
    const reader = new PacketReader();
    expect(reader.push(bytes.subarray(0, 2))).toEqual([]);
    const packets = [...reader.push(bytes.subarray(2, 100)), ...reader.push(bytes.subarray(100))];
    expect(packets.map((packet) => packet.body.length)).toEqual([305, 4]);
  });

  test('a packet above the size limit is refused', () => {
    const reader = new PacketReader(10);
    expect(() => reader.push(encodePublish('t', new Uint8Array(20)))).toThrow('size limit');
  });

  test('topic filters match single and multi-level wildcards', () => {
    expect(matches('spBv1.0/g/+/n/#', 'spBv1.0/g/NBIRTH/n')).toBe(true);
    expect(matches('spBv1.0/g/+/n/#', 'spBv1.0/g/DDATA/n/d1')).toBe(true);
    expect(matches('spBv1.0/g/+/n/#', 'spBv1.0/g/DDATA/m/d1')).toBe(false);
    expect(matches('a/+', 'a/b/c')).toBe(false);
  });
});

describe('Sparkplug B', () => {
  test('every scalar type decodes, signed and 64-bit values without loss', () => {
    const payload = decodePayload(
      encodeSparkplug({
        seq: 4,
        timestamp: 1_700_000_000_000,
        metrics: [
          { name: 'i8', datatype: DataType.Int8, value: -5 },
          { name: 'i32', datatype: DataType.Int32, value: -2_000_000_000 },
          { name: 'u32', datatype: DataType.UInt32, value: 4_000_000_000 },
          { name: 'i64', datatype: DataType.Int64, value: -9_000_000_000n },
          { name: 'u64', datatype: DataType.UInt64, value: 18_446_744_073_709_551_615n },
          { name: 'f', datatype: DataType.Float, value: 1.5 },
          { name: 'd', datatype: DataType.Double, value: 0.1 },
          { name: 'b', datatype: DataType.Boolean, value: true },
          { name: 's', datatype: DataType.String, value: 'ok' },
          { name: 'n', datatype: DataType.Double, value: null },
        ],
      }),
    );
    expect(payload.seq).toBe(4);
    expect(payload.timestamp).toBe(1_700_000_000_000);
    expect(Object.fromEntries(payload.metrics.map((m) => [m.name, m.value]))).toEqual({
      i8: -5,
      i32: -2_000_000_000,
      u32: 4_000_000_000,
      i64: -9_000_000_000,
      u64: '18446744073709551615',
      f: 1.5,
      d: 0.1,
      b: true,
      s: 'ok',
      n: null,
    });
  });

  test('data by alias, a sequence gap, an old death and a device death', () => {
    const state = new SparkplugState();
    const apply = (topic: string, payload: Parameters<typeof encodeSparkplug>[0]) =>
      state.apply(parseTopic(topic)!, decodePayload(encodeSparkplug(payload)));
    apply('spBv1.0/plant/NBIRTH/press', {
      seq: 0,
      metrics: [
        { name: 'bdSeq', datatype: DataType.Int64, value: 3 },
        { name: 'temp', alias: 1, datatype: DataType.Double, value: 20 },
      ],
    });
    apply('spBv1.0/plant/DBIRTH/press/mold', {
      seq: 1,
      metrics: [{ name: 'cycles', alias: 2, datatype: DataType.UInt32, value: 10 }],
    });
    apply('spBv1.0/plant/NDATA/press', {
      seq: 2,
      metrics: [
        { alias: 1, datatype: DataType.Double, value: 21 },
        { alias: 1, datatype: DataType.Double, value: 99, historical: true },
      ],
    });
    apply('spBv1.0/plant/DDATA/press/mold', {
      seq: 3,
      metrics: [{ alias: 2, datatype: DataType.UInt32, value: 11 }],
    });
    expect(state.read('plant', 'press', undefined, 'temp')).toEqual({ value: 21, current: true });
    expect(state.read('plant', 'press', 'mold', 'cycles')).toEqual({ value: 11, current: true });

    apply('spBv1.0/plant/NDEATH/press', {
      metrics: [{ name: 'bdSeq', datatype: DataType.Int64, value: 2 }],
    });
    expect(state.read('plant', 'press', undefined, 'temp')?.current).toBe(true);

    apply('spBv1.0/plant/DDEATH/press/mold', { seq: 4, metrics: [] });
    expect(state.read('plant', 'press', 'mold', 'cycles')?.current).toBe(false);

    apply('spBv1.0/plant/NDATA/press', {
      seq: 9,
      metrics: [{ alias: 1, datatype: DataType.Double, value: 22 }],
    });
    expect(state.read('plant', 'press', undefined, 'temp')).toEqual({ value: 22, current: false });

    apply('spBv1.0/plant/NBIRTH/press', {
      seq: 0,
      metrics: [{ name: 'temp', alias: 1, datatype: DataType.Double, value: 23 }],
    });
    expect(state.read('plant', 'press', undefined, 'temp')).toEqual({ value: 23, current: true });
    expect(state.read('plant', 'press', 'mold', 'cycles')).toBeUndefined();
  });
});

describe('observer', () => {
  const context = { principalId: 'observer' } as ExecutionContext;
  const fields = [
    { id: 'press.temp', sparkplug: { group: 'plant', node: 'press', metric: 'temp' } },
    { id: 'line.speed', topic: 'line/1/speed', pointer: '/value' },
  ];

  test('subscribes to what the fields need', () => {
    expect(filtersFor(fields)).toEqual(['spBv1.0/plant/+/press/#', 'line/1/speed']);
  });

  test('values become readings, a dropped broker makes them uncertain, and nothing is published', async () => {
    const broker = new FakeBroker();
    brokers.push(broker);
    const port = broker.start();
    const submitted: Invocation[] = [];
    const observer = createMqttObserver({
      subscriber: {
        network: networkTo(port),
        destination: 'plant-broker',
        clientId: 'observer-1',
        username: 'reader',
        password: 'secret',
        retryMs: 20,
      },
      fields,
      application: {
        invokeRaw: async (request) => {
          submitted.push(request);
          return { cursor: submitted.length } as never;
        },
      },
      context,
      ingestOperation: 'line.reading.ingest',
      heartbeatMs: 1,
    });
    observer.start(60_000);
    try {
      await until(() => observer.connected);
      expect(broker.connects).toEqual([{ clientId: 'observer-1', username: 'reader' }]);
      broker.publish(
        'spBv1.0/plant/NBIRTH/press',
        encodeSparkplug({
          seq: 0,
          metrics: [{ name: 'temp', alias: 1, datatype: DataType.Double, value: 71.5 }],
        }),
      );
      broker.publish('line/1/speed', JSON.stringify({ value: 12 }));
      await Bun.sleep(30);
      const { observation } = await observer.runOnce();
      expect(observation.readings.map((r) => [r.field, r.value, r.status])).toEqual([
        ['press.temp', 71.5, 'observed'],
        ['line.speed', 12, 'observed'],
      ]);
      expect(submitted.at(-1)!.operation).toBe('line.reading.ingest');
      expect(submitted.at(-1)!.idempotencyKey).toStartWith('observe:mqtt:plant-broker:');

      broker.disconnectAll();
      await until(() => !observer.connected);
      const after = await observer.runOnce();
      expect(after.observation.readings.map((r) => [r.field, r.status])).toEqual([
        ['press.temp', 'uncertain'],
        ['line.speed', 'uncertain'],
      ]);
      await until(() => observer.connected);
      expect(broker.published).toEqual([]);
    } finally {
      await observer.stop();
    }
  });

  test('a refused connection is reported and retried', async () => {
    const broker = new FakeBroker();
    brokers.push(broker);
    const port = broker.start();
    broker.refuseNext = 5;
    const errors: string[] = [];
    const observer = createMqttObserver({
      subscriber: {
        network: networkTo(port),
        destination: 'plant-broker',
        clientId: 'observer-2',
        retryMs: 10,
        onError: (error) => errors.push(String(error)),
      },
      fields,
      application: { invokeRaw: async () => ({ cursor: 0 }) as never },
      context,
      ingestOperation: 'line.reading.ingest',
    });
    observer.start(60_000);
    try {
      await until(() => observer.connected);
      expect(errors[0]).toContain('refused the connection (code 5)');
      expect(broker.connects.length).toBe(2);
    } finally {
      await observer.stop();
    }
  });
});

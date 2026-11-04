import { afterEach, describe, expect, test } from 'bun:test';
import type { NetworkPort } from '@tortoise/kernel/plugin';
import type { ExecutionContext, Invocation } from '@tortoise/runtime';
import { OpcUaClient, createOpcUaObserver, formatNodeId, parseNodeId } from '../src';
import { Reader, Writer } from '../src/binary';
import { readVariant, writeNodeId, readNodeId } from '../src/types';
import { FakeOpcUaServer } from '../src/testing';

const networkTo = (port: number): NetworkPort =>
  ({
    client: () => {
      throw new Error('no http');
    },
    routedFetch: () => fetch,
    socket: (_destination: string, handler: Bun.SocketHandler) =>
      Bun.connect({ hostname: '127.0.0.1', port, socket: handler }),
  }) as unknown as NetworkPort;

const servers: FakeOpcUaServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});
function server() {
  const fake = new FakeOpcUaServer();
  servers.push(fake);
  return { fake, port: fake.start() };
}
const clientOptions = (port: number) => ({
  network: networkTo(port),
  destination: 'plc-gateway',
  endpointUrl: 'opc.tcp://plc-gateway:4840/ua',
  timeoutMs: 1_000,
});

describe('encoding', () => {
  test('node IDs parse, format and round-trip in every binary form', () => {
    for (const text of [
      'i=85',
      'ns=1;i=1000',
      'ns=300;i=70000',
      'ns=2;s=Press.Temp',
      'ns=3;g=72962b91-fa75-4ae6-8d28-b404dc7daf63',
      'ns=4;b=AQID',
    ]) {
      const node = parseNodeId(text);
      expect(formatNodeId(node)).toBe(text);
      const writer = new Writer();
      writeNodeId(writer, node);
      expect(formatNodeId(readNodeId(new Reader(writer.finish())))).toBe(text);
    }
    expect(() => parseNodeId('ns=2;x=1')).toThrow('Not an OPC UA node ID');
  });

  test('an array or structured value is skipped exactly and reported unsupported', () => {
    const writer = new Writer()
      .byte(0x80 | 6)
      .int32(2)
      .int32(1)
      .int32(2)
      .byte(11)
      .double(4.5);
    const reader = new Reader(writer.finish());
    expect(readVariant(reader)).toEqual({ unsupported: 'array' });
    expect(readVariant(reader)).toEqual({ value: 4.5 });
  });
});

describe('client', () => {
  test('opens an anonymous session, reads values in chunks, and closes', async () => {
    const { fake, port } = server();
    fake.chunkSize = 7;
    fake.values.set('ns=2;s=Press.Temp', { double: 71.5 });
    fake.values.set('ns=2;s=Press.State', { value: 'RUN' });
    const client = new OpcUaClient(clientOptions(port));
    await client.connect();
    const values = await client.read([
      parseNodeId('ns=2;s=Press.Temp'),
      parseNodeId('ns=2;s=Press.State'),
      parseNodeId('ns=2;s=Missing'),
    ]);
    expect(values.map((value) => [value.value, value.status])).toEqual([
      [{ value: 71.5 }, 0],
      [{ value: 'RUN' }, 0],
      [undefined, 0x80340000],
    ]);
    await client.close();
    // The close message is the last thing written; give the server a moment to read it.
    await Bun.sleep(20);
    expect(fake.hellos).toEqual(['opc.tcp://plc-gateway:4840/ua']);
    expect(fake.requests).toEqual([
      'OpenSecureChannel',
      'CreateSession',
      'ActivateSession',
      'Read',
      'CloseSession',
      'CloseSecureChannel',
    ]);
  });

  test('a server without an anonymous unsecured endpoint is refused with the reason', async () => {
    const { fake, port } = server();
    fake.endpoints = [
      { ...fake.endpoints[0]!, userIdentityTokens: [{ policyId: 'user', tokenType: 1 }] },
    ];
    const client = new OpcUaClient(clientOptions(port));
    await expect(client.connect()).rejects.toThrow('no anonymous sign-in');
    await client.close();
  });

  test('the channel token is renewed before its lifetime ends', async () => {
    const { fake, port } = server();
    fake.tokenLifetimeMs = 1_400;
    const client = new OpcUaClient(clientOptions(port));
    await client.connect();
    await Bun.sleep(1_200);
    expect(fake.renewals).toBe(1);
    await client.read([parseNodeId('i=2258')]);
    await client.close();
  });

  test('a fault for an ended session fails the read', async () => {
    const { fake, port } = server();
    const client = new OpcUaClient(clientOptions(port));
    await client.connect();
    fake.dropSessions();
    await expect(client.read([parseNodeId('i=2258')])).rejects.toThrow('0x80250000');
    await client.close();
  });
});

describe('observer', () => {
  test('values become readings, a lost server makes them uncertain, and only reads are sent', async () => {
    const { fake, port } = server();
    fake.values.set('ns=2;s=Press.Temp', { double: 70 });
    fake.values.set('ns=2;s=Press.Pressure', { value: 3, status: 0x40000000 });
    const submitted: Invocation[] = [];
    const observer = createOpcUaObserver({
      client: clientOptions(port),
      fields: [
        { id: 'press.temp', node: 'ns=2;s=Press.Temp' },
        { id: 'press.pressure', node: 'ns=2;s=Press.Pressure' },
      ],
      application: {
        invokeRaw: async (request) => {
          submitted.push(request);
          return { cursor: submitted.length } as never;
        },
      },
      context: { principalId: 'observer' } as ExecutionContext,
      ingestOperation: 'press.reading.ingest',
      heartbeatMs: 1,
    });
    const first = await observer.runOnce();
    expect(first.observation.readings.map((r) => [r.field, r.value, r.status])).toEqual([
      ['press.temp', 70, 'observed'],
      ['press.pressure', 3, 'uncertain'],
    ]);
    expect(submitted[0]!.idempotencyKey).toStartWith('observe:opcua:plc-gateway:');
    fake.stop();
    await Bun.sleep(20);
    const after = await observer.runOnce();
    expect(after.observation.readings.map((r) => [r.field, r.value, r.status])).toEqual([
      ['press.temp', 70, 'uncertain'],
      ['press.pressure', 3, 'uncertain'],
    ]);
    await observer.stop();
    expect(fake.requests.filter((request) => request.startsWith('unsupported'))).toEqual([]);
  });
});

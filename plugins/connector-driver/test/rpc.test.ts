import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { createRpcConnection, maxLineLength } from '../src/protocol/rpc';

/** A connection whose driver side is two pipes the test writes to and reads from. */
function connection() {
  const fromDriver = new PassThrough();
  const toDriver = new PassThrough();
  const malformed: string[] = [];
  const notified: unknown[] = [];
  const rpc = createRpcConnection(
    { input: fromDriver, output: toDriver },
    {
      onNotification: (method, params) => notified.push([method, params]),
      onMalformed: (line) => malformed.push(line),
    },
  );
  return { rpc, fromDriver, malformed, notified };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('a line over the limit is dropped as malformed, and the lines after it still arrive', async () => {
  const { fromDriver, malformed, notified } = connection();
  // The oversized line arrives in chunks with no newline, as a runaway driver would write it.
  for (let sent = 0; sent <= maxLineLength; sent += 64 * 1024)
    fromDriver.write('x'.repeat(64 * 1024));
  fromDriver.write('still the same line\n');
  fromDriver.write('{"jsonrpc":"2.0","method":"event","params":{"n":1}}\r\n');
  await tick();
  expect(malformed).toEqual([`A line longer than ${maxLineLength} characters`]);
  expect(notified).toEqual([['event', { n: 1 }]]);
});

test('a reply split across chunks and multi-byte characters resolves its request', async () => {
  const { rpc, fromDriver } = connection();
  const reply = rpc.request<string>('read', {}, { timeoutMs: 1000 });
  const bytes = Buffer.from('{"jsonrpc":"2.0","id":1,"result":"Prüfstand"}\n');
  fromDriver.write(bytes.subarray(0, 37));
  fromDriver.write(bytes.subarray(37));
  expect(await reply).toBe('Prüfstand');
});

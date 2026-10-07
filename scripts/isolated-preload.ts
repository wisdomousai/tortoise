/**
 * Preload for `bun run test:isolated`: proves the suite needs nothing beyond loopback.
 *
 * Every outbound connection attempt made in the test process (`fetch`, `Bun.connect`,
 * `node:net`, `node:tls`, `WebSocket`) to a host other than loopback throws, and is recorded.
 * At exit, any recorded attempt fails the run, even when a test caught the error.
 *
 * Trust boundary: an in-process trap, not an OS sandbox. It catches code paths that bypass the
 * egress guard, but child processes (spawned CLIs, provider SDK processes) are not covered;
 * the exported OS rules and the sandbox binary run cover them.
 */
import net from 'node:net';
import tls from 'node:tls';
import { afterAll } from 'bun:test';

const attempts: string[] = [];
const loopbackHost = (host: string | undefined) => {
  if (!host) return true; // Node defaults to localhost.
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    bare === 'localhost' ||
    bare.endsWith('.localhost') ||
    bare === '::1' ||
    bare === '0:0:0:0:0:0:0:1' ||
    /^127\.\d+\.\d+\.\d+$/.test(bare) ||
    /^::ffff:127\./.test(bare)
  );
};
function guard(api: string, host: string | undefined, port?: unknown) {
  if (loopbackHost(host)) return;
  const attempt = `${api} ${host}${port === undefined ? '' : `:${String(port)}`}`;
  attempts.push(attempt);
  throw new Error(`test:isolated blocked non-loopback egress: ${attempt}`);
}

const originalFetch = globalThis.fetch;
const trappedFetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  // `unix` sockets and data/blob/file URLs never leave the host.
  const local =
    (init as { unix?: string } | undefined)?.unix !== undefined ||
    !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol);
  // Rejects like a real network failure, so `.catch()` handlers see it the same way.
  try {
    if (!local) guard('fetch', url.hostname, url.port || undefined);
  } catch (error) {
    return Promise.reject(error);
  }
  return originalFetch(input, init);
}) as typeof fetch;
globalThis.fetch = Object.assign(trappedFetch, originalFetch);

const originalConnect = Bun.connect;
Bun.connect = ((options: { hostname?: string; port?: number; unix?: string }) => {
  if (options.unix === undefined) guard('Bun.connect', options.hostname, options.port);
  return originalConnect(options as Parameters<typeof Bun.connect>[0]);
}) as typeof Bun.connect;

/** `connect(port, host)`, `connect(options)` and `connect(path)` (a unix socket, allowed). */
function target(args: unknown[]): { host?: string; port?: unknown; local: boolean } {
  const [first, second] = args;
  if (typeof first === 'object' && first !== null) {
    const options = first as { host?: string; port?: unknown; path?: string };
    return { host: options.host, port: options.port, local: options.path !== undefined };
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return { local: true };
  return { host: typeof second === 'string' ? second : undefined, port: first, local: false };
}
const originalSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  const { host, port, local } = target(Array.isArray(args[0]) ? (args[0] as unknown[]) : args);
  if (!local) guard('net.connect', host, port);
  return (originalSocketConnect as (...values: unknown[]) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;
const originalTlsConnect = tls.connect;
(tls as { connect: unknown }).connect = (...args: unknown[]) => {
  const { host, port, local } = target(args);
  if (!local) guard('tls.connect', host, port);
  return (originalTlsConnect as (...values: unknown[]) => tls.TLSSocket)(...args);
};

const OriginalWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class extends OriginalWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    guard('WebSocket', new URL(String(url)).hostname);
    super(url, protocols);
  }
} as typeof WebSocket;

afterAll(() => {
  if (!attempts.length) return;
  process.exitCode = 1;
  process.stderr.write(
    `test:isolated: ${attempts.length} non-loopback connection attempt(s):\n${[...new Set(attempts)]
      .map((attempt) => `  - ${attempt}`)
      .join('\n')}\n`,
  );
});

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { EgressDenied, type Egress } from './guard';

export interface EgressProxy {
  readonly url: URL;
  /**
   * Environment for a declared child process: proxy variables carrying a per-process credential,
   * so the proxy knows which declaration applies. Merge it into an otherwise minimal env.
   */
  childEnvironment(processId: string): Record<string, string>;
  close(): Promise<void>;
}

const maxHeaderBytes = 8 * 1024;

/** What the proxy shares across connections: issued credentials and open sockets. */
interface ProxyState {
  readonly egress: Egress;
  readonly tokens: Map<string, Buffer>;
  readonly sockets: Set<Socket>;
}

function refuse(client: Socket, status: number) {
  const text =
    {
      403: 'Forbidden',
      405: 'Method Not Allowed',
      407: 'Proxy Authentication Required',
      431: 'Request Header Fields Too Large',
      502: 'Bad Gateway',
    }[status] ?? 'Error';
  client.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** The declared process whose credential the request presents, compared in constant time. */
function processFor(tokens: ReadonlyMap<string, Buffer>, header: string): string | undefined {
  const match = /^proxy-authorization:\s*basic\s+(\S+)\s*$/im.exec(header);
  if (!match) return undefined;
  const [processId, token] = Buffer.from(match[1]!, 'base64').toString('utf8').split(':');
  const expected = processId ? tokens.get(processId) : undefined;
  const given = Buffer.from(token ?? '');
  return expected && expected.length === given.length && timingSafeEqual(expected, given)
    ? processId
    : undefined;
}

/** Authorize a CONNECT target for its process, then splice the client to the upstream. */
async function tunnel(state: ProxyState, client: Socket, header: string, rest: Buffer) {
  const [requestLine] = header.split('\r\n');
  const target = /^CONNECT ([^\s]+) HTTP\/1\.[01]$/i.exec(requestLine ?? '');
  if (!target) return refuse(client, 405);
  const processId = processFor(state.tokens, header);
  if (!processId) return refuse(client, 407);
  const separator = target[1]!.lastIndexOf(':');
  const host = target[1]!.slice(0, separator);
  const port = Number(target[1]!.slice(separator + 1));
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return refuse(client, 403);
  try {
    await state.egress.authorizeProcessTarget(processId, host, port);
  } catch (error) {
    return refuse(client, error instanceof EgressDenied ? 403 : 502);
  }
  const upstream = connect({ host: host.replace(/^\[|\]$/g, ''), port });
  state.sockets.add(upstream);
  upstream.on('close', () => state.sockets.delete(upstream));
  upstream.once('connect', () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (rest.length) upstream.write(rest);
    client.pipe(upstream);
    upstream.pipe(client);
    client.resume();
  });
  upstream.on('error', () => {
    if (!client.destroyed) refuse(client, 502);
  });
  client.on('close', () => upstream.destroy());
}

/** Read the request head (bounded), then hand the paused client to `tunnel`. */
function accept(state: ProxyState, client: Socket) {
  state.sockets.add(client);
  client.on('close', () => state.sockets.delete(client));
  client.on('error', () => client.destroy());
  let head = Buffer.alloc(0);
  const onData = (chunk: Buffer) => {
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf('\r\n\r\n');
    if (end < 0) {
      if (head.length > maxHeaderBytes) refuse(client, 431);
      return;
    }
    client.off('data', onData);
    client.pause();
    void tunnel(state, client, head.subarray(0, end).toString('latin1'), head.subarray(end + 4));
  };
  client.on('data', onData);
}

/** Proxy variables carrying one random credential per process ID, issued on first use. */
function childEnvironment(state: ProxyState, port: number, processId: string) {
  state.egress.process(processId);
  // One random credential per process ID, compared as the text the client sends back.
  let token = state.tokens.get(processId);
  if (!token) {
    token = Buffer.from(randomBytes(24).toString('base64url'));
    state.tokens.set(processId, token);
  }
  const proxy = `http://${encodeURIComponent(processId)}:${token.toString()}@127.0.0.1:${port}`;
  return {
    HTTPS_PROXY: proxy,
    https_proxy: proxy,
    HTTP_PROXY: proxy,
    http_proxy: proxy,
    ALL_PROXY: proxy,
    NO_PROXY: '',
    no_proxy: '',
  };
}

/**
 * Loopback HTTP CONNECT proxy for child processes such as provider CLIs. A child reaches only
 * the bound destinations its process declaration lists; each tunnel is audited through the
 * egress guard. Only CONNECT is supported, so plain-HTTP requests through the proxy are refused.
 *
 * A child that ignores proxy variables bypasses this proxy; the exported OS rules are what
 * contain it. Tunnel contents stay end-to-end encrypted and are not inspected.
 */
export async function startEgressProxy(egress: Egress): Promise<EgressProxy> {
  const state: ProxyState = { egress, tokens: new Map(), sockets: new Set() };
  const server: Server = createServer((client) => accept(state, client));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Proxy did not bind');
  const url = new URL(`http://127.0.0.1:${address.port}`);
  return {
    url,
    childEnvironment: (processId) => childEnvironment(state, address.port, processId),
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of state.sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

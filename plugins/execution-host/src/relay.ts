import { chmod } from 'node:fs/promises';
import { connect, createServer, type Server, type Socket } from 'node:net';

/**
 * The host side of a sandbox's only network path: a unix socket in the run's socket directory
 * that forwards each connection to one fixed loopback port, either the host's own API listener
 * or the network CONNECT proxy. The sandbox cannot choose the port, so it reaches the API (where
 * its token is checked on every call) and the proxy (where its process ID's destinations are
 * checked and audited), and nothing else on the host.
 */
export interface Relay {
  readonly path: string;
  close(): Promise<void>;
}

export async function startRelay(path: string, port: number): Promise<Relay> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((client) => {
    const upstream = connect({ host: '127.0.0.1', port });
    sockets.add(client).add(upstream);
    const close = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on('error', close).on('close', close);
    upstream.on('error', close).on('close', close);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => resolve());
  });
  // Only the sandbox's own user may connect; the directory is private too.
  await chmod(path, 0o600);
  return {
    path,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

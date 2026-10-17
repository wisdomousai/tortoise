import { ApplicationError } from '@agent-native/contracts';
import type { NetworkPort } from '@agent-native/kernel/plugin';

/** Moved to the portable kernel; this subpath keeps existing imports working. */
export * from '@agent-native/kernel/plugin';

/**
 * The network port with Bun's socket types, as the network plugin provides it on Bun. Callers on
 * Bun reach its optional members through `bunSocket` and `childEnvironment`.
 */
export interface BunNetworkPort extends NetworkPort {
  /** A TCP socket to one declared `tcp` destination. */
  socket<Data = undefined>(
    destinationId: string,
    handler: Bun.SocketHandler<Data>,
  ): Promise<Bun.Socket<Data>>;
  /** Environment that confines a declared child process to its declared destinations. */
  childEnvironment(processId: string): Record<string, string>;
}

const unavailable = (what: string) =>
  new ApplicationError(
    'UNAVAILABLE',
    `${what} is unreachable: the composed network port does not offer it`,
  );

/** The port's socket with Bun's types; each call rejects UNAVAILABLE when the provider has none. */
export function bunSocket(network: NetworkPort): BunNetworkPort['socket'] {
  const { socket } = network as Partial<BunNetworkPort>;
  return socket
    ? socket.bind(network)
    : (destinationId: string) => Promise.reject(unavailable(`Socket destination ${destinationId}`));
}

/** The port's child-process environment; throws UNAVAILABLE when the provider has none. */
export function childEnvironment(network: NetworkPort, processId: string): Record<string, string> {
  if (!network.childEnvironment) throw unavailable(`Child process ${processId}`);
  return network.childEnvironment(processId);
}

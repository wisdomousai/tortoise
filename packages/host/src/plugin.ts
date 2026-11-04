import { ApplicationError } from '@tortoise/contracts';
import type { NetworkPort, ProcessPort, ProcessSpawnOptions } from '@tortoise/kernel/plugin';

/** Moved to the portable kernel; this subpath keeps existing imports working. */
export * from '@tortoise/kernel/plugin';

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

/**
 * The parts of a Node child process with piped streams that callers of the process port use.
 * Structural, so host code names no process module; the process plugin returns the real child.
 */
export interface SpawnedChild {
  readonly pid?: number;
  readonly exitCode: number | null;
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
}

/**
 * A started child on Bun and the way to stop its whole process tree. Call `terminate`, not
 * `child.kill`, which reaches only the group leader.
 */
export interface SpawnedProcess {
  readonly child: SpawnedChild;
  /** Ask the tree to stop, then force it after a grace period. Safe to call more than once. */
  terminate(): void;
}

/** The process port with Bun's child type, as the process plugin provides it on Bun. */
export interface BunProcessPort extends ProcessPort {
  spawn(processId: string, options?: ProcessSpawnOptions): Promise<SpawnedProcess>;
}

/** The port's `spawn` with Bun's types. The kernel default rejects UNAVAILABLE as before. */
export function bunProcesses(processes: ProcessPort): BunProcessPort['spawn'] {
  return processes.spawn.bind(processes) as BunProcessPort['spawn'];
}

/** The port's child-process environment; throws UNAVAILABLE when the provider has none. */
export function childEnvironment(network: NetworkPort, processId: string): Record<string, string> {
  if (!network.childEnvironment) throw unavailable(`Child process ${processId}`);
  return network.childEnvironment(processId);
}

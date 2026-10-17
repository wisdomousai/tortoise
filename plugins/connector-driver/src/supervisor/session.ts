import { createHash } from 'node:crypto';
import type { JsonObject } from '@agent-native/contracts';
import { driverContractText, driverProtocolVersion, type DriverContract } from '../contracts';
import {
  createRpcConnection,
  DriverError,
  eventNotification,
  initializeAnswer,
  type EventNotification,
  type InitializeAnswer,
  type RpcConnection,
} from '../protocol';

/** A started driver process: its piped streams and the way to stop its process tree. */
export interface DriverProcess {
  readonly child: {
    readonly stdin: NodeJS.WritableStream;
    readonly stdout: NodeJS.ReadableStream;
    readonly stderr: NodeJS.ReadableStream;
    on(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
  };
  terminate(): void;
}

/** Who may act: `monitor-only` never, `assist` hazard-free actions, `actuate` every action. */
export type DriverMode = 'monitor-only' | 'assist' | 'actuate';

/** SHA-256 of the contract's canonical document; a driver built from the same contract echoes it. */
export const driverContractDigest = (contract: DriverContract) =>
  createHash('sha256').update(driverContractText(contract)).digest('hex');

/** How a driver process ended: an exit code, or the signal that stopped it. */
export interface DriverExit {
  readonly code: number | null;
  readonly signal: string | null;
}

/** One running driver after a successful handshake. */
export interface DriverSession {
  readonly rpc: RpcConnection;
  readonly process: DriverProcess;
  readonly hello: InitializeAnswer;
  /** Resolves when the process exits, for whatever reason, with its exit code or signal. */
  readonly exited: Promise<DriverExit>;
}

export interface SessionOptions {
  readonly contract: DriverContract;
  readonly digest: string;
  readonly mode: DriverMode;
  readonly configuration?: JsonObject;
  readonly handshakeMs: number;
  onEvent(event: EventNotification): void;
  onProblem(problem: string): void;
}

/**
 * Start a driver and complete the handshake: protocol version, then contract digest. A driver
 * that answers anything else, or nothing in time, is stopped and the start fails with a
 * `protocol` or `timeout` error. Notifications other than valid `event`s are reported as problems.
 */
export async function openSession(
  started: DriverProcess,
  options: SessionOptions,
): Promise<DriverSession> {
  let exit!: (how: DriverExit) => void;
  const exited = new Promise<DriverExit>((resolve) => (exit = resolve));
  const rpc = createRpcConnection(
    { input: started.child.stdout, output: started.child.stdin },
    {
      onNotification(method, params) {
        const event = method === 'event' ? eventNotification.safeParse(params) : undefined;
        if (event?.success) options.onEvent(event.data);
        else options.onProblem(`Driver sent an invalid ${method} notification`);
      },
      onMalformed: () => options.onProblem('Driver wrote a line that is not a JSON-RPC message'),
    },
  );
  const stop = (error: DriverError, how: DriverExit) => (rpc.close(error), exit(how));
  started.child.on('exit', (code, signal) =>
    stop(new DriverError('exited', `Driver ${options.contract.id} exited (${code ?? signal})`), {
      code,
      signal,
    }),
  );
  started.child.on('error', () =>
    stop(new DriverError('exited', `Driver ${options.contract.id} could not run`), {
      code: null,
      signal: null,
    }),
  );
  // Driver diagnostics stay local; they may contain device paths or vendor output.
  started.child.stderr.resume();
  try {
    const raw = await rpc.request(
      'initialize',
      {
        protocol: driverProtocolVersion,
        contract: { id: options.contract.id, digest: options.digest },
        configuration: options.configuration ?? {},
        mode: options.mode,
      },
      { timeoutMs: options.handshakeMs },
    );
    const parsed = initializeAnswer.safeParse(raw);
    if (!parsed.success)
      throw new DriverError(
        'protocol',
        `Driver ${options.contract.id} answered initialize invalidly`,
      );
    if (parsed.data.contract.digest !== options.digest)
      throw new DriverError(
        'protocol',
        `Driver ${options.contract.id} was built for another contract (digest ${parsed.data.contract.digest.slice(0, 12)})`,
      );
    return { rpc, process: started, hello: parsed.data, exited };
  } catch (error) {
    started.terminate();
    throw error instanceof DriverError
      ? error
      : new DriverError('protocol', `Driver ${options.contract.id} failed its handshake`);
  }
}

import type { JsonObject, JsonValue } from '@agent-native/contracts';
import type { DriverContract } from './contracts';
import {
  DriverError,
  invokeResult,
  actionLookupResult,
  stateResult,
  type EventNotification,
  type InitializeResult,
  type InvokeResult,
  type ActionLookupResult,
  type StateResult,
} from './protocol';
import {
  driverContractDigest,
  openSession,
  type DriverMode,
  type DriverProcess,
  type DriverSession,
} from './supervisor/session';
import { createEventQueue } from './supervisor/events';

export { driverContractDigest, type DriverMode, type DriverProcess } from './supervisor/session';

export interface DriverSupervisorOptions {
  readonly contract: DriverContract;
  /** Start the driver executable. A host passes its process port's start for the declared process. */
  readonly start: () => Promise<DriverProcess>;
  /**
   * The bridge mode sent at the handshake; defaults to monitor-only. Each action carries the mode
   * the connector read for it, so a mode change applies to the next action without a restart.
   */
  readonly mode?: () => DriverMode;
  readonly configuration?: JsonObject;
  readonly handshakeMs?: number;
  /** Health check interval; 0 turns it off. A failed check stops the driver. */
  readonly healthMs?: number;
  /** Backoff after a failed or short-lived start, doubling up to `max`. */
  readonly backoff?: { readonly minMs: number; readonly maxMs: number };
  /** Events in order, after validation. Awaited one at a time from a bounded queue. */
  readonly onEvent?: (event: EventNotification, session: InitializeResult) => Promise<void> | void;
  /** A new session started: the driver restarted, so anything derived from its state is stale. */
  readonly onSession?: (session: InitializeResult) => void;
  /** Sequence gaps, dropped events, malformed lines, failed health checks. Caller-safe text. */
  readonly onProblem?: (problem: string) => void;
  readonly now?: () => number;
}

/** What a status screen shows about one driver. */
export interface DriverStatus {
  readonly state: 'stopped' | 'starting' | 'ready' | 'backing-off';
  readonly driver?: InitializeResult['driver'];
  readonly session?: string;
  readonly devices: InitializeResult['devices'];
  readonly digest: string;
  readonly starts: number;
  readonly lastError?: string;
  readonly problems: number;
}

/**
 * Keeps one driver running for the host:
 * 1. Starts it on first use and completes the handshake, refusing a contract digest mismatch.
 * 2. Rejects requests in flight with `exited` when it stops. Whether that makes an action
 *    uncertain is the connector's decision, by the action's delivery mode.
 * 3. Starts it again on the next request, after a backoff that doubles while starts keep failing.
 *    Requests during the backoff fail as transient, so the dispatcher retries later.
 * 4. Checks health on an interval, delivers events in order through a bounded queue, and
 *    reports sequence gaps.
 * 5. On close, asks the driver to shut down, then stops its process tree.
 */
export function createDriverSupervisor(options: DriverSupervisorOptions) {
  const digest = driverContractDigest(options.contract);
  const now = options.now ?? Date.now;
  const backoff = options.backoff ?? { minMs: 1_000, maxMs: 60_000 };
  let session: DriverSession | undefined;
  let starting: Promise<DriverSession> | undefined;
  let closed = false;
  let failures = 0;
  let retryAt = 0;
  let starts = 0;
  let problems = 0;
  let lastError: string | undefined;
  let health: ReturnType<typeof setInterval> | undefined;
  const problem = (text: string) => (problems++, options.onProblem?.(text));
  const events = createEventQueue(1_000, problem);

  async function launch(): Promise<DriverSession> {
    starts++;
    const opened = await openSession(await options.start(), {
      contract: options.contract,
      digest,
      mode: options.mode?.() ?? 'monitor-only',
      ...(options.configuration ? { configuration: options.configuration } : {}),
      handshakeMs: options.handshakeMs ?? 10_000,
      onEvent: (event) => events.push(event, opened.hello, options.onEvent),
      onProblem: problem,
    });
    events.begin(opened.hello.session);
    failures = 0;
    session = opened;
    options.onSession?.(opened.hello);
    if (options.healthMs) health = setInterval(() => void check(opened), options.healthMs);
    void opened.exited.then(() => {
      if (session === opened) session = undefined;
      clearInterval(health);
      if (!closed) lastError = `Driver ${options.contract.id} stopped`;
    });
    return opened;
  }

  async function check(opened: DriverSession) {
    await opened.rpc.request('health', {}, { timeoutMs: options.healthMs! }).catch(() => {
      problem(`Driver ${options.contract.id} failed its health check`);
      opened.process.terminate();
    });
  }

  /** The running session, starting one if needed. */
  async function ready(): Promise<DriverSession> {
    if (closed) throw new DriverError('transient', `Driver ${options.contract.id} is closed`);
    if (session) return session;
    if (!starting) {
      if (now() < retryAt)
        throw new DriverError('transient', `Driver ${options.contract.id} is restarting`);
      starting = launch().catch((error: unknown) => {
        failures++;
        retryAt = now() + Math.min(backoff.maxMs, backoff.minMs * 2 ** (failures - 1));
        lastError = error instanceof Error ? error.message : 'Driver failed to start';
        throw error instanceof DriverError
          ? error
          : new DriverError('transient', `Driver ${options.contract.id} could not start`);
      });
      void starting.finally(() => (starting = undefined)).catch(() => undefined);
    }
    return starting;
  }

  /** One request on the current session, its response checked against `schema`. */
  async function call<T>(
    method: string,
    params: unknown,
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    const { rpc } = await ready();
    const parsed = schema.safeParse(
      await rpc.request(method, params, { timeoutMs, ...(signal ? { signal } : {}) }),
    );
    if (!parsed.success)
      throw new DriverError(
        'protocol',
        `Driver ${options.contract.id} sent an invalid ${method} response`,
      );
    return parsed.data;
  }

  return {
    digest,
    ready,
    read: (fields: readonly string[], signal?: AbortSignal): Promise<StateResult> =>
      call('state.read', { fields }, stateResult, 10_000, signal),
    invoke: (
      action: string,
      input: JsonValue,
      effectId: string,
      mode: DriverMode,
      signal?: AbortSignal,
    ): Promise<InvokeResult> => {
      const timeoutMs = options.contract.actions[action]!.timeoutMs;
      return call(
        'action.invoke',
        { action, input, effectId, mode, deadline: now() + timeoutMs },
        invokeResult,
        timeoutMs,
        signal,
      );
    },
    lookup: (effectId: string, signal?: AbortSignal): Promise<ActionLookupResult> =>
      call('action.lookup', { effectId }, actionLookupResult, 10_000, signal),
    status: (): DriverStatus => ({
      state: session
        ? 'ready'
        : starting
          ? 'starting'
          : now() < retryAt
            ? 'backing-off'
            : 'stopped',
      ...(session ? { driver: session.hello.driver, session: session.hello.session } : {}),
      devices: session?.hello.devices ?? [],
      digest,
      starts,
      ...(lastError ? { lastError } : {}),
      problems,
    }),
    async close() {
      closed = true;
      const running = session ?? (await starting?.catch(() => undefined));
      if (!running) return;
      await running.rpc.request('shutdown', {}, { timeoutMs: 2_000 }).catch(() => undefined);
      running.process.terminate();
      await running.exited;
      await events.drained();
    },
  };
}
export type DriverSupervisor = ReturnType<typeof createDriverSupervisor>;

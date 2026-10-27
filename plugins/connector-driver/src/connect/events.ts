import type { JsonValue } from '@agent-native/contracts';
import type { DeviceIdentity } from '@agent-native/observation';
import type { CommandReceipt, ExecutionContext, Invocation } from '@agent-native/runtime';
import type { DriverContract } from '../contracts/define';
import type { DriverService } from '../open';
import type { EventNotification, InitializeResult } from '../protocol';

/** One driver event as an ingest command receives it, with the unit that reported it. */
export interface DriverEventRecord {
  readonly driver: string;
  /** The driver session; with `seq` it names the event exactly once. */
  readonly session: string;
  readonly seq: number;
  readonly name: string;
  readonly payload?: JsonValue;
  /** The host's clock when the event was received. The driver's own `at` is not trusted. */
  readonly observedAt: number;
  readonly device: DeviceIdentity;
}

export interface DriverEventIngestOptions {
  readonly contract: DriverContract;
  readonly service: Pick<DriverService, 'onEvent' | 'supervisor'>;
  readonly application: {
    invokeRaw(request: Invocation, context: ExecutionContext): Promise<CommandReceipt>;
  };
  /** The observing principal, granted the ingest operation only. */
  readonly context: ExecutionContext;
  readonly ingestOperation: string;
  /** The declared events to ingest; others are ignored. */
  readonly events: readonly string[];
  /** Map an event to the ingest command's input. Defaults to the record itself. */
  readonly toInput?: (record: DriverEventRecord) => unknown;
  readonly now?: () => number;
  /**
   * A driver starts on its first request. An event-only driver gets none, so the ingest asks for
   * a running session this often (and the supervisor restarts it after a crash). Default 5 s.
   */
  readonly keepAliveMs?: number;
}

/** The unit an event names, from the handshake that opened its session. */
export function eventDevice(event: EventNotification, session: InitializeResult): DeviceIdentity {
  const unit = session.devices[event.device ?? 0];
  return {
    driver: session.driver.id,
    driverVersion: session.driver.version,
    ...(unit?.serial ? { serial: unit.serial } : {}),
    ...(unit?.firmware ? { firmware: unit.firmware } : {}),
  };
}

/**
 * Reports a driver's events through the application's ingest command, one command per event, as
 * the observer reports its state. It never acts on the equipment.
 *
 * - The idempotency key is `driver:<id>:<session>:<seq>`, which names one event, so a replayed
 *   event cannot record twice and two events can never share a key.
 * - Events are handled in order, one at a time, from the supervisor's queue. A failed ingest is
 *   reported through `onError` and not retried: the event is gone, and the supervisor's
 *   sequence check already reports events the driver lost.
 * - The payload is passed as the driver sent it; the ingest command's input schema is what
 *   validates it.
 */
export function createDriverEventIngest(options: DriverEventIngestOptions) {
  const { contract } = options;
  for (const name of options.events)
    if (!contract.events?.[name])
      throw new Error(`Driver ${contract.id} declares no event ${name}`);
  const wanted = new Set(options.events);
  const now = options.now ?? Date.now;
  let unsubscribe: (() => void) | undefined;
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  async function ingest(event: EventNotification, session: InitializeResult) {
    const record: DriverEventRecord = {
      driver: contract.id,
      session: event.session,
      seq: event.seq,
      name: event.name,
      ...(event.payload !== undefined ? { payload: event.payload } : {}),
      observedAt: now(),
      device: eventDevice(event, session),
    };
    return options.application.invokeRaw(
      {
        operation: options.ingestOperation,
        input: options.toInput ? options.toInput(record) : record,
        idempotencyKey: `driver:${contract.id}:${event.session}:${event.seq}`,
      },
      options.context,
    );
  }

  return {
    ingest,
    /** Subscribe and keep the driver running until `stop`. */
    start(onError?: (error: unknown) => void) {
      if (unsubscribe) return;
      unsubscribe = options.service.onEvent(contract.id, async (event, session) => {
        if (!wanted.has(event.name)) return;
        await ingest(event, session).catch((error: unknown) => {
          onError?.(error);
          throw error;
        });
      });
      const supervisor = options.service.supervisor(contract.id);
      const ensure = () => void supervisor.ready().catch((error: unknown) => onError?.(error));
      ensure();
      keepAlive = setInterval(ensure, options.keepAliveMs ?? 5_000);
    },
    async stop() {
      unsubscribe?.();
      clearInterval(keepAlive);
      unsubscribe = undefined;
      keepAlive = undefined;
    },
  };
}
export type DriverEventIngest = ReturnType<typeof createDriverEventIngest>;

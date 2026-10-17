import { ApplicationError, type JsonObject } from '@agent-native/contracts';
import {
  bunProcesses,
  type PluginInstance,
  type PluginOpenContext,
} from '@agent-native/host/plugin';
import type { DriverContract } from './contracts/define';
import type { DriverStatusView } from './contracts/status';
import type { EventNotification, InitializeAnswer } from './protocol';
import { createDriverSupervisor, type DriverSupervisor } from './supervisor';

type EventListener = (event: EventNotification, session: InitializeAnswer) => Promise<void> | void;
type SessionListener = (session: InitializeAnswer) => void;

/**
 * What the driver plugin offers the application and later plugins as `services.driver`: one
 * supervisor per declared driver, its status, and subscriptions to its events and restarts. An
 * application builds its outbox targets with `createDriverConnector` over `supervisor(id)`, and
 * its observers with `createDriverObserver`.
 */
export interface DriverService {
  readonly contracts: readonly DriverContract[];
  /** The running supervisor for a declared driver; throws NOT_FOUND for any other id. */
  supervisor(id: string): DriverSupervisor;
  status(): DriverStatusView[];
  /** Events in order from one driver; returns the unsubscribe. A failing listener is reported, not retried. */
  onEvent(id: string, listener: EventListener): () => void;
  /** A driver started a new session, so anything derived from its earlier state is stale. */
  onSession(id: string, listener: SessionListener): () => void;
}

export interface DriverPluginOptions {
  readonly contracts: readonly DriverContract[];
  /** Per driver id: the `configuration` sent at the handshake. Host configuration, never caller input. */
  readonly configuration?: Readonly<Record<string, JsonObject>>;
  /** Health check interval; defaults to 30 seconds, 0 turns it off. */
  readonly healthMs?: number;
  readonly backoff?: { readonly minMs: number; readonly maxMs: number };
}

/** The driver service among a plugin's or handler's services; throws UNAVAILABLE without the plugin. */
export function driverServiceOf(services: Readonly<Record<string, unknown>>): DriverService {
  const service = services.driver as DriverService | undefined;
  if (!service)
    throw new ApplicationError('UNAVAILABLE', 'This host does not run the driver plugin');
  return service;
}

function listeners<T>() {
  const byDriver = new Map<string, Set<T>>();
  return {
    add(id: string, listener: T) {
      const set = byDriver.get(id) ?? new Set<T>();
      byDriver.set(id, set);
      set.add(listener);
      return () => void set.delete(listener);
    },
    of: (id: string) => [...(byDriver.get(id) ?? [])],
  };
}

function statusOf(contract: DriverContract, supervisor: DriverSupervisor): DriverStatusView {
  return {
    id: contract.id,
    title: contract.title,
    version: contract.version,
    ...supervisor.status(),
    devices: [...supervisor.status().devices],
    actions: Object.entries(contract.actions).map(([id, action]) => ({
      id,
      title: action.title,
      delivery: action.delivery,
      hazard: action.hazard,
    })),
  };
}

/**
 * Create one supervisor per declared driver. None starts here: a driver starts on its first
 * request, through the process port, which resolves only after every plugin has opened. Each
 * starts in monitor-only at its handshake; the mode of each action travels with that action.
 */
export function openDrivers(
  options: DriverPluginOptions,
  context: Pick<PluginOpenContext, 'ports'>,
): PluginInstance & { readonly service: DriverService } {
  const events = listeners<EventListener>();
  const sessions = listeners<SessionListener>();
  const supervisors = new Map<string, DriverSupervisor>();
  for (const contract of options.contracts) {
    const configuration = options.configuration?.[contract.id];
    supervisors.set(
      contract.id,
      createDriverSupervisor({
        contract,
        start: () => bunProcesses(context.ports.processes)(contract.process.id),
        ...(configuration ? { configuration } : {}),
        healthMs: options.healthMs ?? 30_000,
        ...(options.backoff ? { backoff: options.backoff } : {}),
        async onEvent(event, session) {
          // Every listener sees every event; one failure is reported once by the queue.
          let failed = false;
          for (const listener of events.of(contract.id))
            try {
              await listener(event, session);
            } catch {
              failed = true;
            }
          if (failed) throw new Error(`A listener failed on ${event.name}`);
        },
        onSession: (session) => sessions.of(contract.id).forEach((listener) => listener(session)),
      }),
    );
  }
  const service: DriverService = {
    contracts: options.contracts,
    supervisor(id) {
      const supervisor = supervisors.get(id);
      if (!supervisor) throw new ApplicationError('NOT_FOUND', `No driver ${id} is declared`);
      return supervisor;
    },
    status: () =>
      options.contracts.map((contract) => statusOf(contract, supervisors.get(contract.id)!)),
    onEvent: events.add,
    onSession: sessions.add,
  };
  return {
    service,
    describe: () => ({ drivers: options.contracts.map((contract) => contract.id) }),
    async close() {
      await Promise.all([...supervisors.values()].map((supervisor) => supervisor.close()));
    },
  };
}

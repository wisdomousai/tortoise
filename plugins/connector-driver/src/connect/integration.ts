import type { Target } from '@tortoise/contracts';
import {
  createEffectDispatcher,
  targetContext,
  type DispatcherApplication,
} from '@tortoise/integration';
import type { ExecutionContext } from '@tortoise/runtime';
import type { DriverContract } from '../contracts/define';
import type { DriverSupervisor } from '../supervisor';
import { createDriverConnector, type DriverConnectorOptions } from './connector';
import { createDriverObserver, type DriverObserverOptions } from './observer';

export interface DriverIntegrationOptions {
  /** The outbox target, declared with `defineTarget` and no inbound: a driver has nothing to pull. */
  readonly target: Target;
  readonly application: DispatcherApplication & DriverObserverOptions['application'];
  readonly workspaceId: string;
  /** The integration principal; granted the target's complete and status operations only. */
  readonly principalId: string;
  readonly contract: DriverContract;
  readonly supervisor: DriverSupervisor;
  readonly control: DriverConnectorOptions['control'];
  /** Observe the driver's state through this ingest command, under the same principal. */
  readonly observe?: Pick<
    DriverObserverOptions,
    'ingestOperation' | 'toInput' | 'heartbeatMs' | 'fields'
  >;
}

/**
 * One driver wired as an outbox target, and optionally observed. Like `connectTarget` for a
 * system of record, but with no inbound: delivery completes through the target's fenced complete
 * command, and the observer reports state through the application's ingest command. The
 * principal's grant names only those operations, so a misbehaving driver cannot reach business
 * commands. `start` runs the loops (delivery every second, observation every 2 s by default).
 */
export function createDriverIntegration(options: DriverIntegrationOptions) {
  // The driver component declares its process as the carrier of the target named after the
  // contract; another name would leave the data-flow manifest pointing elsewhere.
  if (options.target.target !== options.contract.id)
    throw new Error(
      `Driver ${options.contract.id} carries target ${options.contract.id}, not ${options.target.target}`,
    );
  const port = createDriverConnector({
    target: options.target.target,
    contract: options.contract,
    supervisor: options.supervisor,
    control: options.control,
  });
  const context = targetContext(options.target, options.workspaceId, options.principalId);
  const dispatcher = createEffectDispatcher({
    application: options.application,
    port,
    context,
    completeOperation: options.target.complete.id,
    completeInput: (effect, outcome, attempt) => ({
      effectId: effect.id,
      outcome,
      fence: attempt.fence,
    }),
  });
  const observeContext: ExecutionContext | undefined = options.observe && {
    ...context,
    grant: {
      operations: [options.observe.ingestOperation],
      principalId: options.principalId,
      workspaceId: options.workspaceId,
    },
  };
  const observer =
    options.observe &&
    createDriverObserver({
      ...options.observe,
      contract: options.contract,
      supervisor: options.supervisor,
      application: options.application,
      context: observeContext!,
    });
  return {
    target: options.target.target,
    port,
    dispatcher,
    observer,
    start(
      intervals: { readonly deliverMs?: number; readonly observeMs?: number } = {},
      onError?: (error: unknown) => void,
    ) {
      dispatcher.start(intervals.deliverMs ?? 1_000);
      observer?.start(intervals.observeMs ?? 2_000, onError);
    },
    async stop() {
      await Promise.all([dispatcher.stop(), observer?.stop()]);
    },
  };
}
export type DriverIntegration = ReturnType<typeof createDriverIntegration>;

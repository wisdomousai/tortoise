import {
  ApplicationError,
  type AnyCapability,
  type CapabilitiesOf,
  type CapabilityById,
  type CapabilityModule,
  type InputOf,
  type OutputOf,
} from '@agent-native/contracts';
import { createCommands } from './application/commands.js';
import { grantPermits } from './application/delegation.js';
import { createEvents } from './application/events.js';
import { createKernel, type ApplicationOptions, type Kernel } from './application/kernel.js';
import { createOutbox } from './application/outbox.js';
import { createQueries } from './application/queries.js';
import { createRecovery } from './application/recovery.js';
import type {
  CommandReceipt,
  ExecutionContext,
  HandlerContribution,
  Invocation,
  QueryResult,
  RemoteHandler,
} from './types.js';

export type { ApplicationOptions } from './application/kernel.js';

/** Bind typed handler contributions without erasing each capability's input and output literals. */
export function createHandlerFactory<State, Services>() {
  return <C extends AnyCapability>(
    capability: C,
    handle: HandlerContribution<State, Services, C>['handle'],
  ): HandlerContribution<State, Services, C> => ({ capability, handle });
}

/**
 * Bind remote query handlers (capabilities that declare `remote`). The handler supplies only the
 * pure `request` and `item` steps; the runtime calls the source between them and never calls
 * `handle`, so a remote query cannot read the target from inside a transaction.
 */
export function createRemoteQueryFactory<State, Services>() {
  return <C extends AnyCapability & { readonly kind: 'query'; readonly remote: object }>(
    capability: C,
    remote: RemoteHandler<State, Services, C>,
  ): HandlerContribution<State, Services, C> => ({
    capability,
    remote,
    handle: () => {
      throw new ApplicationError('INTERNAL', 'Remote queries run through their source');
    },
  });
}

/** The catalog as this context may use it: operations outside a live grant are `denied`. */
function createDiscovery<State, Services>(kernel: Kernel<State, Services>) {
  return function discover(context: ExecutionContext) {
    kernel.guard.trusted(context);
    return {
      ...kernel.catalog,
      operations: kernel.catalog.operations.map((operation) => ({
        ...operation,
        availability: grantPermits(context.grant, kernel.now(), operation.id)
          ? ('conditional' as const)
          : ('denied' as const),
      })),
    };
  };
}

/** Compose pure capability definitions with private host implementations. No transport owns business execution. */
export function createApplication<
  State,
  Services,
  const Modules extends readonly CapabilityModule[],
>(options: ApplicationOptions<State, Services, Modules>) {
  const kernel = createKernel<State, Services>(options);
  const invokeRaw = createCommands(kernel);
  const queryRaw = createQueries(kernel);
  type Command = Extract<CapabilitiesOf<Modules>, { kind: 'command' }>;
  type Query = Extract<CapabilitiesOf<Modules>, { kind: 'query' }>;
  function invoke<Id extends Command['id']>(
    request: Invocation<InputOf<CapabilityById<Command, Id>>> & { readonly operation: Id },
    context: ExecutionContext,
  ): Promise<CommandReceipt<OutputOf<CapabilityById<Command, Id>>>> {
    return invokeRaw(request, context) as Promise<
      CommandReceipt<OutputOf<CapabilityById<Command, Id>>>
    >;
  }
  function query<Id extends Query['id']>(
    request: Invocation<InputOf<CapabilityById<Query, Id>>> & { readonly operation: Id },
    context: ExecutionContext,
  ): Promise<QueryResult<OutputOf<CapabilityById<Query, Id>>>> {
    return queryRaw(request, context) as Promise<QueryResult<OutputOf<CapabilityById<Query, Id>>>>;
  }
  const { events, deliverEvents } = createEvents(kernel);
  const { pendingEffects, recordAttempt } = createOutbox(kernel);
  return {
    catalog: kernel.catalog,
    invoke,
    query,
    invokeRaw,
    queryRaw,
    events,
    deliverEvents,
    discover: createDiscovery(kernel),
    pendingEffects,
    recordAttempt,
    recoverAudit: createRecovery(kernel),
  };
}

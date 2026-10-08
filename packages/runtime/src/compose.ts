import type { CapabilityModule } from '@agent-native/contracts';
import type {
  AuthorizationPort,
  HandlerContext,
  HandlerContribution,
  RemoteHandler,
} from './types.js';

/**
 * Adapt handlers authored against one module's state slice to a composed application state.
 * Each handler sees only `state[key]`; the runtime still commits the whole state, receipts,
 * journal and outbox atomically, so a command remains one transaction across the application.
 * Change, revision and effect operations are shared because resources are application-wide.
 */
export function sliceHandlers<Root, K extends keyof Root & string, Services>(
  key: K,
  handlers: readonly HandlerContribution<Root[K], Services>[],
): HandlerContribution<Root, Services>[] {
  return handlers.map((handler) => {
    const slice = (context: HandlerContext<Root, Services>) => ({
      ...context,
      state: context.state[key],
    });
    const remote = handler.remote;
    return {
      capability: handler.capability,
      handle: (input, context) => handler.handle(input as never, slice(context)),
      ...(remote
        ? {
            remote: {
              request: (input, context) => remote.request(input as never, slice(context)),
              item: (found, context) => remote.item(found, slice(context)),
            } satisfies RemoteHandler<Root, Services>,
          }
        : {}),
    };
  });
}

/** One module's policy, the state slice it reads and the journal resource types it governs. */
export interface AuthorizationRoute<Root> {
  readonly module: CapabilityModule;
  readonly resourceTypes: readonly string[];
  readonly select: (state: Root) => unknown;
  readonly port: AuthorizationPort<unknown>;
}
export function authorizationRoute<Root, K extends keyof Root>(
  key: K,
  module: CapabilityModule,
  resourceTypes: readonly string[],
  port: AuthorizationPort<Root[K]>,
): AuthorizationRoute<Root> {
  return {
    module,
    resourceTypes,
    select: (state) => state[key],
    port: port as AuthorizationPort<unknown>,
  };
}

/**
 * Route authorization to the owning module's policy with that module's state slice. Operations
 * route by registered module; events route by resource type (the text before `:`). Anything
 * unrouted is denied, so adding a module without a policy fails closed.
 */
export function composeAuthorization<Root>(
  routes: readonly AuthorizationRoute<Root>[],
): AuthorizationPort<Root> {
  const byOperation = new Map<string, AuthorizationRoute<Root>>();
  const byResourceType = new Map<string, AuthorizationRoute<Root>>();
  for (const route of routes) {
    for (const capability of route.module.capabilities) {
      if (byOperation.has(capability.id))
        throw new Error(`Operation has two authorization routes: ${capability.id}`);
      byOperation.set(capability.id, route);
    }
    for (const type of route.resourceTypes) {
      if (!type || type.includes(':') || byResourceType.has(type))
        throw new Error(`Invalid or duplicate routed resource type: ${type}`);
      byResourceType.set(type, route);
    }
  }
  return {
    authorize(request) {
      const route = byOperation.get(request.capability.id);
      if (!route) return { allowed: false, reason: 'NO_POLICY' };
      return route.port.authorize({
        ...request,
        state: route.select(request.state),
        ...(request.previousState === undefined
          ? {}
          : { previousState: route.select(request.previousState) }),
      });
    },
    projectOutput(request) {
      const route = byOperation.get(request.capability.id);
      if (!route?.port.projectOutput) return request.output;
      return route.port.projectOutput({
        ...request,
        state: route.select(request.state),
        ...(request.previousState === undefined
          ? {}
          : { previousState: route.select(request.previousState) }),
      });
    },
    canReadEvent(request) {
      const separator = request.event.resource.indexOf(':');
      const route =
        separator > 0 ? byResourceType.get(request.event.resource.slice(0, separator)) : undefined;
      return route
        ? route.port.canReadEvent({ ...request, state: route.select(request.state) })
        : false;
    },
  };
}

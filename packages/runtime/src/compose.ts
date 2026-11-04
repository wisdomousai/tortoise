import type { CapabilityModule } from '@tortoise/contracts';
import type {
  FeatureComposition,
  FeatureHandler,
  FeaturePolicy,
  FeatureServer,
} from './feature.js';
import type {
  AuthorizationPort,
  AuthorizationRequest,
  ChangeEvent,
  Decision,
  ExecutionContext,
  HandlerContext,
  HandlerContribution,
  RemoteHandler,
} from './types.js';

type Root = Record<string, unknown>;
type HostHook = (...args: never[]) => unknown;

/**
 * A feature or plugin bound into one application: the key of its state slice, the access view
 * the application computes from its whole state, and the hooks it supplies. Each hook receives
 * the feature's arguments followed by the handler context over the application's state.
 */
export interface BoundUnit<State> {
  readonly key: string;
  readonly feature: Pick<FeatureServer, 'handlers'>;
  readonly access?: (state: State) => unknown;
  readonly hooks?: Readonly<Record<string, HostHook | undefined>>;
}

function scopedContext<State, Services>(
  unit: BoundUnit<State>,
  context: HandlerContext<State, Services>,
) {
  const scoped = { ...context, state: (context.state as Root)[unit.key] } as Record<
    string,
    unknown
  >;
  // The access view is computed once per handler call, and only when the handler reads it.
  let access: { value: unknown } | undefined;
  Object.defineProperty(scoped, 'access', {
    enumerable: true,
    get: () => (access ??= { value: unit.access?.(context.state) }).value,
  });
  const hooks: Record<string, unknown> = {};
  for (const [name, hook] of Object.entries(unit.hooks ?? {}))
    if (hook) hooks[name] = (...args: unknown[]) => (hook as Function)(...args, context);
  scoped['hooks'] = Object.freeze(hooks);
  return scoped as never;
}

/**
 * Adapt a feature's handlers to the application's state. Each handler sees only `state[key]`,
 * the access view and the bound hooks; the runtime still commits the whole state, command results,
 * journal and outbox atomically, so a command remains one transaction across the application.
 * Change, revision and effect operations are shared because resources are application-wide.
 */
export function featureHandlers<State, Services>(
  unit: BoundUnit<State>,
  composition: FeatureComposition,
): HandlerContribution<State, Services>[] {
  const declared = unit.feature.handlers;
  const handlers: readonly FeatureHandler<unknown, unknown, unknown, unknown>[] =
    typeof declared === 'function' ? declared(composition) : (declared ?? []);
  return handlers.map((handler) => {
    const remote = handler.remote;
    const scope = (context: HandlerContext<State, Services>) => scopedContext(unit, context);
    return {
      capability: handler.capability,
      handle: (input, context) => handler.handle(input as never, scope(context)),
      ...(remote
        ? {
            remote: {
              request: (input, context) => remote.request(input as never, scope(context)),
              item: (found, context) => remote.item(found, scope(context)),
            } satisfies RemoteHandler<State, Services>,
          }
        : {}),
    };
  });
}

/**
 * Adapt handlers authored against one module's state slice to a composed application state.
 * A feature without an access view or hooks; see `featureHandlers`.
 */
export function sliceHandlers<Root, K extends keyof Root & string, Services>(
  key: K,
  handlers: readonly HandlerContribution<Root[K], Services>[],
): HandlerContribution<Root, Services>[] {
  return featureHandlers<Root, Services>(
    { key, feature: { handlers: handlers as never } },
    { modules: [], applicationModules: [] },
  );
}

/**
 * One unit's policy for routing: the operations and journal resource types it decides, the state
 * it reads and the access view it receives.
 */
export interface AuthorizationUnit<State> {
  readonly id: string;
  readonly operations: readonly string[];
  readonly resourceTypes: readonly string[];
  readonly select: (state: State) => unknown;
  readonly access?: (state: State) => unknown;
  readonly port: FeaturePolicy<any, any>;
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

const resourceType = (resource: string) => {
  const separator = resource.indexOf(':');
  return separator > 0 ? resource.slice(0, separator) : undefined;
};
const deny = (reason: string): Decision => ({ allowed: false, reason });

/** Unit routes by operation and resource type, refusing a claim made twice or by the application. */
function routes<State>(
  application: AuthorizationPort<State> | undefined,
  units: readonly AuthorizationUnit<State>[],
) {
  const byOperation = new Map<string, AuthorizationUnit<State>>();
  const byResourceType = new Map<string, AuthorizationUnit<State>>();
  const claimed = {
    operations: new Set(application?.covers?.operations ?? []),
    resourceTypes: new Set(application?.covers?.resourceTypes ?? []),
  };
  for (const unit of units) {
    for (const operation of unit.operations) {
      if (byOperation.has(operation))
        throw new Error(`Operation has two authorization routes: ${operation}`);
      if (claimed.operations.has(operation))
        throw new Error(
          `The application policy has a rule for ${operation}, which "${unit.id}" decides`,
        );
      byOperation.set(operation, unit);
    }
    for (const type of unit.resourceTypes) {
      if (!type || type.includes(':') || byResourceType.has(type))
        throw new Error(`Invalid or duplicate routed resource type: ${type}`);
      if (claimed.resourceTypes.has(type))
        throw new Error(
          `Resource type "${type}" has an application event rule and belongs to "${unit.id}"`,
        );
      byResourceType.set(type, unit);
    }
  }
  return { byOperation, byResourceType };
}

/** The request as one unit sees it: its slice, its access view and, at commit, both before. */
function forUnit<State, R extends { state: State; previousState?: State }>(
  unit: AuthorizationUnit<State>,
  request: R,
) {
  return {
    ...request,
    state: unit.select(request.state),
    access: unit.access?.(request.state),
    ...(request.previousState === undefined
      ? {}
      : {
          previousState: unit.select(request.previousState),
          previousAccess: unit.access?.(request.previousState),
        }),
  };
}

/**
 * Route authorization to the owning unit's policy with that unit's state slice and access view,
 * and everything else to `application`. Operations route by id; events and resources route by
 * resource type (the text before `:`). Without an application port anything unrouted is denied,
 * so adding a module without a policy fails closed.
 *
 * Fails at composition when two units claim one operation or resource type, or when the
 * application port's `covers` claims one a unit owns, so a unit can never silently shadow an
 * application rule. An application port without `covers` cannot be checked.
 */
export function routeAuthorization<State>(
  application: AuthorizationPort<State> | undefined,
  units: readonly AuthorizationUnit<State>[],
): AuthorizationPort<State> {
  const { byOperation, byResourceType } = routes(application, units);
  const covers = {
    operations: [...(application?.covers?.operations ?? []), ...byOperation.keys()],
    resourceTypes: [...(application?.covers?.resourceTypes ?? []), ...byResourceType.keys()],
  };
  const byResource = (resource: string) => {
    const type = resourceType(resource);
    return type === undefined ? undefined : byResourceType.get(type);
  };
  const readsEvent = (
    port: { canReadEvent: AuthorizationPort<any>['canReadEvent'] } | undefined,
    request: { event: ChangeEvent; context: ExecutionContext; state: unknown },
  ) => (port ? port.canReadEvent(request as never) : false);
  return {
    covers,
    authorize(request: AuthorizationRequest<State>) {
      const unit = byOperation.get(request.capability.id);
      if (unit) return unit.port.authorize(forUnit(unit, request));
      return application ? application.authorize(request) : deny('NO_POLICY');
    },
    projectOutput(request) {
      const unit = byOperation.get(request.capability.id);
      if (unit)
        return unit.port.projectOutput
          ? unit.port.projectOutput(forUnit(unit, request))
          : request.output;
      return application?.projectOutput ? application.projectOutput(request) : request.output;
    },
    canReadEvent(request) {
      const unit = byResource(request.event.resource);
      return unit
        ? unit.port.canReadEvent(forUnit(unit, request))
        : readsEvent(application, request);
    },
    canReadResource(request) {
      const unit = byResource(request.resource);
      if (unit) {
        const scoped = forUnit(unit, request);
        return unit.port.canReadResource
          ? unit.port.canReadResource(scoped)
          : unit.port.canReadEvent(scoped);
      }
      if (application?.canReadResource) return application.canReadResource(request);
      return readsEvent(application, request);
    },
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
  return routeAuthorization<Root>(
    undefined,
    routes.map((route) => ({
      id: route.module.id,
      operations: route.module.capabilities.map((capability) => capability.id),
      resourceTypes: route.resourceTypes,
      select: route.select,
      port: route.port as FeaturePolicy<unknown, unknown>,
    })),
  );
}

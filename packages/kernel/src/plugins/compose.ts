import {
  sliceHandlers,
  type AuthorizationPort,
  type HandlerContribution,
} from '@agent-native/runtime';
import type { AnyHostPlugin } from '../plugin';

type Root = Record<string, unknown>;

/**
 * Check that the server plugins are exactly the manifest's, in the same order, and that each
 * plugin's `requires` is composed before it. Order matters because the host opens plugins in it.
 */
export function checkPlugins(
  declared: readonly { readonly id: string }[],
  plugins: readonly AnyHostPlugin[],
) {
  const ids = plugins.map((plugin) => plugin.manifest.id);
  const expected = declared.map((plugin) => plugin.id);
  if (ids.join() !== expected.join())
    throw new Error(
      `Application plugins [${ids.join(', ')}] do not match its manifest's [${expected.join(', ')}]`,
    );
  for (const [index, plugin] of plugins.entries())
    for (const required of plugin.requires ?? [])
      if (!ids.slice(0, index).includes(required))
        throw new Error(`Plugin "${plugin.manifest.id}" requires "${required}" composed before it`);
}

const statefulPlugins = (plugins: readonly AnyHostPlugin[]) =>
  plugins.filter((plugin) => plugin.state);

/** The application's state with a fresh slice per stateful plugin, under the plugin's id. */
export function composeCreateState(
  create: (ownerId: string) => unknown,
  plugins: readonly AnyHostPlugin[],
) {
  return (ownerId: string): Root => {
    const state = create(ownerId) as Root;
    const slices: Root = {};
    for (const plugin of statefulPlugins(plugins)) {
      const key = plugin.manifest.id;
      if (Object.hasOwn(state, key))
        throw new Error(`Application state already has a "${key}" key; plugin slices own it`);
      slices[key] = plugin.state!.create(ownerId);
    }
    return { ...state, ...slices };
  };
}

/**
 * Upgrade stored state. The application's upgrade sees the state without plugin slices, so it
 * cannot drop or rewrite them; each slice is then kept, upgraded by its plugin, or created when
 * the plugin is new to this workspace.
 */
export function composeUpgradeState(
  upgrade: ((state: unknown, ownerId: string) => unknown) | undefined,
  plugins: readonly AnyHostPlugin[],
) {
  const keys = new Set(statefulPlugins(plugins).map((plugin) => plugin.manifest.id));
  return (stored: unknown, ownerId: string): Root => {
    const value = (stored ?? {}) as Root;
    const own = Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key)));
    const state = (upgrade ? upgrade(own, ownerId) : own) as Root;
    const slices: Root = {};
    for (const plugin of statefulPlugins(plugins)) {
      const key = plugin.manifest.id;
      const slice = value[key];
      slices[key] =
        slice === undefined
          ? plugin.state!.create(ownerId)
          : plugin.state!.upgrade
            ? plugin.state!.upgrade(slice, ownerId)
            : slice;
    }
    return { ...state, ...slices };
  };
}

/** Plugin handlers, each bound to its plugin's slice. */
export function composeHandlers(
  handlers: readonly HandlerContribution<any, any>[],
  plugins: readonly AnyHostPlugin[],
): HandlerContribution<any, any>[] {
  return [
    ...handlers,
    ...plugins.flatMap((plugin) =>
      plugin.handlers
        ? sliceHandlers<Root, string, unknown>(plugin.manifest.id, plugin.handlers)
        : [],
    ),
  ];
}

interface Route {
  readonly key: string;
  readonly port: AuthorizationPort<unknown>;
}

/** Operation and resource-type routes to each plugin's policy, checked for collisions. */
function pluginRoutes(plugins: readonly AnyHostPlugin[]) {
  const byOperation = new Map<string, Route>();
  const byResourceType = new Map<string, Route>();
  for (const plugin of plugins) {
    if (!plugin.authorization) continue;
    const route: Route = { key: plugin.manifest.id, port: plugin.authorization.port };
    for (const module of plugin.manifest.modules)
      for (const capability of module.capabilities) byOperation.set(capability.id, route);
    for (const type of plugin.authorization.resourceTypes) {
      if (byResourceType.has(type))
        throw new Error(`Resource type "${type}" has two plugin policies`);
      byResourceType.set(type, route);
    }
  }
  return { byOperation, byResourceType };
}

/**
 * The application's policy for its own operations and events, each plugin's policy for its own
 * with that plugin's slice. A plugin can neither authorize an application operation nor read
 * an application event, and the application's policy never sees plugin operations.
 */
export function composeAuthorization(
  application: AuthorizationPort<any>,
  plugins: readonly AnyHostPlugin[],
): AuthorizationPort<Root> {
  const { byOperation, byResourceType } = pluginRoutes(plugins);
  const slice = <R extends { state: Root; previousState?: Root }>(route: Route, request: R) => ({
    ...request,
    state: request.state[route.key],
    ...(request.previousState === undefined
      ? {}
      : { previousState: request.previousState[route.key] }),
  });
  return {
    authorize(request) {
      const route = byOperation.get(request.capability.id);
      return route ? route.port.authorize(slice(route, request)) : application.authorize(request);
    },
    projectOutput(request) {
      const route = byOperation.get(request.capability.id);
      if (!route)
        return application.projectOutput ? application.projectOutput(request) : request.output;
      return route.port.projectOutput
        ? route.port.projectOutput(slice(route, request))
        : request.output;
    },
    canReadEvent(request) {
      const separator = request.event.resource.indexOf(':');
      const route =
        separator > 0 ? byResourceType.get(request.event.resource.slice(0, separator)) : undefined;
      return route
        ? route.port.canReadEvent(slice(route, request))
        : application.canReadEvent(request);
    },
  };
}

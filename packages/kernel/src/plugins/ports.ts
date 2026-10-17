import { ApplicationError } from '@agent-native/contracts';
import type { HostPorts, IngressPort, NetworkPort, PluginInstance } from '../plugin';
import { noFolders } from '../folders';
import { noProcesses } from '../processes';
import { noShell } from '../shell';

const unreachable = (what: string) =>
  new ApplicationError(
    'UNAVAILABLE',
    `${what} is unreachable: this application composes no plugin that provides network access`,
  );

/**
 * No network at all. The kernel has no policy to decide what is allowed, so it allows nothing;
 * a plugin that binds destinations replaces this port. Calls fail the same way an unbound
 * destination does, so callers already handle it.
 */
export const isolatedNetwork: NetworkPort = Object.freeze({
  client: (destinationId: string) => ({
    destination: destinationId,
    fetch: async () => Promise.reject(unreachable(destinationId)),
  }),
  routedFetch: (destinationIds: readonly string[]) =>
    Object.assign(async () => Promise.reject(unreachable(destinationIds.join(', '))), {
      preconnect: () => undefined,
    }) as unknown as typeof fetch,
  socket: async (destinationId: string) => Promise.reject(unreachable(destinationId)),
  childEnvironment: (processId: string) => {
    throw unreachable(`Child process ${processId}`);
  },
});

/** Listening refused: the platform has no listener and no plugin provides one. */
export const noIngress: IngressPort = Object.freeze({
  listen() {
    throw new ApplicationError(
      'UNAVAILABLE',
      'This platform cannot listen for connections and no plugin provides the ingress port',
    );
  },
});

/**
 * The kernel's ports when no plugin provides them: no network, no audit log, the platform's
 * listener if it has one, the local owner admitted, no OS integration, no child processes and no
 * folders.
 */
export function defaultPorts(ingress: IngressPort = noIngress): HostPorts {
  return Object.freeze({
    network: isolatedNetwork,
    ingress,
    identity: Object.freeze({ admit: () => undefined, localOwnerSessions: true }),
    shell: noShell,
    processes: noProcesses,
    folders: noFolders,
  });
}

/**
 * Each port from the one plugin that provides it, else the default. Two providers are a
 * composition error, not something to resolve by order: silently picking one would let a later
 * plugin replace the audit log or the egress guard.
 */
export function resolvePorts(
  instances: readonly { id: string; instance: PluginInstance }[],
  defaults: HostPorts = defaultPorts(),
) {
  const providers = new Map<keyof HostPorts, string>();
  const ports: Record<string, unknown> = { ...defaults };
  for (const { id, instance } of instances)
    for (const [name, port] of Object.entries(instance.ports ?? {}) as [
      keyof HostPorts,
      unknown,
    ][]) {
      if (port === undefined) continue;
      const other = providers.get(name);
      if (other) throw new Error(`Plugins "${other}" and "${id}" both provide the ${name} port`);
      providers.set(name, id);
      ports[name] = port;
    }
  assertNeedsMet(instances, providers);
  return ports as unknown as HostPorts;
}

/** Refuse a composition in which a plugin's configuration needs a port nobody provides. */
function assertNeedsMet(
  instances: readonly { id: string; instance: PluginInstance }[],
  providers: ReadonlyMap<keyof HostPorts, string>,
) {
  for (const { id, instance } of instances)
    for (const name of instance.needs ?? [])
      if (!providers.has(name))
        throw new Error(
          `Plugin "${id}" is configured to need the ${name} port, but no composed plugin provides it`,
        );
}

/**
 * A view of the composed ports for `PluginOpenContext.ports`. Each member reads the port that
 * `bind` set, so a plugin can hold the view during `open` and use it once composition is known.
 */
export function latePorts() {
  let bound: HostPorts | undefined;
  const resolved = () => {
    if (!bound) throw new Error('Host ports are available once every plugin has opened');
    return bound;
  };
  const ports: HostPorts = {
    get eventLog() {
      return resolved().eventLog;
    },
    get network() {
      return resolved().network;
    },
    get ingress() {
      return resolved().ingress;
    },
    get identity() {
      return resolved().identity;
    },
    get shell() {
      return resolved().shell;
    },
    get processes() {
      return resolved().processes;
    },
    get folders() {
      return resolved().folders;
    },
  };
  return {
    ports,
    bind(composed: HostPorts) {
      bound = composed;
    },
  };
}

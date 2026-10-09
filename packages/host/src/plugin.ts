import type { Catalog, EventLogPort, JsonValue } from '@agent-native/contracts';
import type {
  AuthorizationPort,
  DelegationGrant,
  ExecutionContext,
  HandlerContribution,
} from '@agent-native/runtime';
import type { HostedApplication, Observer } from './application';
import type { ApplicationManifest } from './manifest';
import type { PluginManifest } from './plugin-manifest';

/**
 * The only way host code reaches the network. Without a plugin that provides it, every call
 * throws UNAVAILABLE: the kernel itself can reach nothing (see `defaultPorts`).
 */
export interface NetworkPort {
  /**
   * A `fetch` bound to one declared destination's origin; relative paths resolve against it.
   * Callers name the destination, never its address, which only the deployment knows.
   */
  client(destinationId: string): {
    readonly destination: string;
    readonly fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
  };
  /** A `fetch` that reaches only the listed declared destinations, for SDKs with several origins. */
  routedFetch(destinationIds: readonly string[]): typeof fetch;
  /** A TCP socket to one declared `tcp` destination. */
  socket<Data = undefined>(
    destinationId: string,
    handler: Bun.SocketHandler<Data>,
  ): Promise<Bun.Socket<Data>>;
  /** Environment that confines a declared child process to its declared destinations. */
  childEnvironment(processId: string): Record<string, string>;
}

/** Where the authority listens. The default is loopback on the requested port. */
export interface IngressPort {
  listen(
    port: number | undefined,
    handler: (request: Request) => Response | Promise<Response>,
  ): {
    readonly server: { stop(force?: boolean): void; readonly port?: number };
    readonly origin: string;
  };
}

/** Who may act. The default admits every trusted launcher context and the local owner. */
export interface IdentityPort {
  /** Throws FORBIDDEN or UNAVAILABLE when `context` (undefined: the local owner) is not admitted. */
  admit(context: ExecutionContext | undefined): void;
  /** Whether the host issues the local owner a session and a connection file. */
  readonly localOwnerSessions: boolean;
}

/**
 * The kernel's ports. Each has at most one provider plugin and a safe default otherwise: no
 * network, no audit log, a loopback listener, the local owner admitted.
 */
export interface HostPorts {
  readonly eventLog?: EventLogPort;
  readonly network: NetworkPort;
  readonly ingress: IngressPort;
  readonly identity: IdentityPort;
}

/** What `open` receives. Everything here is trusted host input. */
export interface PluginOpenContext {
  readonly manifest: ApplicationManifest;
  readonly catalog: Catalog;
  readonly workspacePath: string;
  /** Audit source component: `authority` for a serving host, `embedded` in-process. */
  readonly component: 'authority' | 'embedded';
  readonly instance: string;
  /** True for a serving host, which may start background work and child processes. */
  readonly serving: boolean;
  /** This plugin's settings that the launcher supplied. */
  readonly settings: Readonly<Record<string, string>>;
  /** Services of the plugins opened before this one, keyed by plugin id. */
  readonly services: Readonly<Record<string, unknown>>;
  /**
   * The composed ports, whichever plugin provides them, so plugins use each other's ports
   * without importing each other: an audit forwarder reaches its collector through the network
   * port, and the egress guard records into the event-log port. Members resolve once every
   * plugin has opened; reading one during `open` throws, because the composition is not known
   * yet. Use them from `ready`, `start`, `close` or the calls the plugin serves.
   */
  readonly ports: HostPorts;
}

/** What `start` receives once a serving host listens. */
export interface PluginStartContext {
  readonly application: HostedApplication;
  readonly workspaceId: string;
  readonly ports: HostPorts;
  /**
   * The local owner narrowed to `grant`, the same delegation an agent run uses. A plugin acts as
   * a caller like any other: it reads and writes only through authorized operations.
   */
  delegate(grant: Pick<DelegationGrant, 'operations' | 'resources'>): ExecutionContext;
  onError(scope: string, error: unknown): void;
}

/** One opened plugin. Every member is optional. */
export interface PluginInstance {
  readonly ports?: Partial<HostPorts>;
  /**
   * Ports this plugin's configuration depends on another plugin to provide, such as an event
   * log for a policy that requires a fail-closed audit trail. Startup refuses when one keeps its
   * kernel default, so configuration never looks enforced while nothing enforces it.
   */
  readonly needs?: readonly (keyof HostPorts)[];
  /** Exposed to later plugins and to handlers as `services[<plugin id>]`. */
  readonly service?: unknown;
  /** After the runtime exists and before anything is served: attestation, crash recovery. */
  ready?(application: HostedApplication): Promise<void>;
  /** Serving host only, after it listens. Returned observers stop before `close`. */
  start?(context: PluginStartContext): Promise<readonly Observer[]>;
  /** Facts for the `listening` record, such as the active profile. */
  describe?(): Record<string, JsonValue>;
  /** Release what `open` acquired. Called once, in reverse opening order. */
  close?(): Promise<void>;
}

/** A command-line verb a plugin adds, run before any workspace is opened. */
export interface PluginCommand {
  usage(program: string): string;
  /** Exit code when the verb is this plugin's, undefined otherwise. */
  run(manifest: ApplicationManifest, args: string[]): Promise<number | undefined>;
}

/**
 * The server part of a plugin. Its state slice lives under `state[manifest.id]`, its handlers see
 * only that slice, and its policy authorizes only its own operations and resource types.
 *
 * Trust boundary: a plugin is trusted code with the host's privileges, like an application
 * definition. It contributes through the same catalog, runtime and ports as everything else, so
 * its operations are authorized and audited and its connections are declared.
 */
export interface HostPlugin<Slice = any, Services = any> {
  readonly manifest: PluginManifest;
  /** Plugins that must be composed, and opened, before this one. */
  readonly requires?: readonly string[];
  readonly state?: {
    create(ownerId: string): Slice;
    upgrade?(stored: unknown, ownerId: string): Slice;
  };
  readonly handlers?: readonly HandlerContribution<Slice, Services>[];
  readonly authorization?: {
    readonly resourceTypes: readonly string[];
    readonly port: AuthorizationPort<Slice>;
  };
  readonly commands?: readonly PluginCommand[];
  open?(context: PluginOpenContext): Promise<PluginInstance>;
}
// Composed plugins are stored without their slice type; the host is generic over it.
export type AnyHostPlugin = HostPlugin<any, any>;

/**
 * Declare a plugin's server part. Fails at definition time when it contributes modules without
 * state, handlers and a policy, since the runtime would refuse it at startup anyway.
 */
export function defineHostPlugin<Slice, Services = unknown>(
  plugin: HostPlugin<Slice, Services>,
): HostPlugin<Slice, Services> {
  const { manifest } = plugin;
  if (manifest.modules.length && !(plugin.state && plugin.handlers && plugin.authorization))
    throw new Error(`Plugin "${manifest.id}" has modules but no state, handlers or policy`);
  return Object.freeze(plugin);
}

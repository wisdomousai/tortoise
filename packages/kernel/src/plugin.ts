import type { Catalog, EventLogPort, JsonValue } from '@agent-native/contracts';
import type {
  AuthorizationPort,
  DelegationGrant,
  ExecutionContext,
  HandlerContribution,
} from '@agent-native/runtime';
import type { HostedApplication, Observer } from './application';
import type { ApplicationManifest } from './manifest';
import type { HostPlatform, SecretStore } from './platform';
import type { PluginManifest } from './plugin-manifest';
import type { PluginSettings } from './plugins/settings';
import type { ProcessPort } from './processes';
import type { ShellPort } from './shell';

export {
  noProcesses,
  type ProcessAvailability,
  type ProcessPort,
  type ProcessSpawnOptions,
} from './processes';
export { noShell, type ShellAdapter, type ShellPort } from './shell';

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
  /**
   * A TCP socket to one declared `tcp` destination, on platforms with the `sockets` capability.
   * Handler and socket are the platform's own types (on Bun, `Bun.SocketHandler` and
   * `Bun.Socket`; see the host's `BunNetworkPort`), so the kernel leaves them opaque.
   */
  socket?(destinationId: string, handler: never): Promise<unknown>;
  /**
   * Environment that confines a declared child process to its declared destinations, on
   * platforms with the `child-process` capability.
   */
  childEnvironment?(processId: string): Record<string, string>;
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
 * network, no audit log, a loopback listener, the local owner admitted, no OS integration and no
 * child processes.
 */
export interface HostPorts {
  readonly eventLog?: EventLogPort;
  readonly network: NetworkPort;
  readonly ingress: IngressPort;
  readonly identity: IdentityPort;
  readonly shell: ShellPort;
  readonly processes: ProcessPort;
}

/** What `provideSettings` receives. */
export interface SettingsProviderContext {
  readonly manifest: ApplicationManifest;
  readonly platform: Pick<HostPlatform, 'id' | 'capabilities'>;
  /** This plugin's own settings that the launcher supplied. */
  readonly settings: PluginSettings;
}

/** What `open` receives. Everything here is trusted host input. */
export interface PluginOpenContext {
  readonly manifest: ApplicationManifest;
  readonly catalog: Catalog;
  /** The platform the authority runs on, so a plugin can adapt to what it offers. */
  readonly platform: Pick<HostPlatform, 'id' | 'capabilities'>;
  readonly workspacePath: string;
  /** Audit source component: `authority` for a serving host, `embedded` in-process. */
  readonly component: 'authority' | 'embedded';
  readonly instance: string;
  /** True for a serving host, which may start background work and child processes. */
  readonly serving: boolean;
  /** This plugin's settings that the launcher supplied. */
  readonly settings: Readonly<Record<string, string>>;
  /** This plugin's own secrets in this workspace, where the platform keeps secrets. */
  readonly secrets?: SecretStore;
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
  /**
   * Serving host only: a request no session covers, such as a device exchanging an enrollment
   * code. It runs after the host's Host-header check and before its origin and session checks, so
   * the plugin owns every other check (one-use codes, rate limits, methods). Read the body only
   * of a request you answer; undefined passes the request on unread.
   */
  publicRoute?(request: Request): Promise<Response | undefined>;
  /**
   * Serving host only: the caller a bearer token stands for when it is not a host session, such
   * as a paired device; undefined when this plugin did not issue the token. The host asks on
   * every request, so a revoked credential stops working at the next one. The returned context
   * is trusted like a session's, so the plugin decides its principal and grant.
   */
  authenticate?(token: string): Promise<ExecutionContext | undefined>;
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
  /**
   * Supply other plugins' settings from a source the launcher does not control, such as a device
   * management profile. Runs before any plugin opens, in composition order, with this plugin's
   * own launcher settings. What it returns is merged with the launcher's settings (see
   * `openPlugins`) and then refused like them when no composed plugin declares a key.
   */
  provideSettings?(context: SettingsProviderContext): Promise<PluginSettings>;
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

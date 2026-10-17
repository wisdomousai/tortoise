import {
  createApplication,
  type AuthorizationPort,
  type BlobStore,
  type ExecutionContext,
  type HandlerContribution,
  type RemoteSource,
  type Storage,
} from '@agent-native/runtime';
import type { CapabilityModule, EventLogPort, HostComponent } from '@agent-native/contracts';
import type { TargetIntegration } from '@agent-native/integration';
import type { ApplicationManifest } from './manifest';
import { deploymentComponents } from './components';
import type { AnyHostPlugin, NetworkPort, ProcessPort } from './plugin';
import { checkMigrations, type StateMigrations } from './migrations';
import {
  checkPlugins,
  composeAuthorization,
  composeCreateState,
  composeHandlers,
  composeUpgradeState,
} from './plugins/compose';

/**
 * Everything the host needs to run one application, supplied by content. The host never
 * names a domain: it receives this value from the starter's configuration and composes runtime,
 * storage, integrations and observers from it.
 *
 * Trust boundary: a definition is trusted code. Its policy, handlers and connections run inside
 * the authority with the host's privileges; only callers are untrusted.
 */
export interface ApplicationDefinition<State, Services = unknown> {
  readonly manifest: ApplicationManifest;
  /** Fresh workspace state; `ownerId` is the local owner principal. */
  readonly createState: (ownerId: string) => State;
  /**
   * Versions of the application's own state and the steps between them. Storage stamps each
   * workspace with the version it holds; see `stateUpgrade` and the `migrate` command.
   */
  readonly migrations?: StateMigrations;
  /**
   * Unversioned normalization of persisted state, run on every load after the migrations, such
   * as filling a field older workspaces lack. Defaults to keeping the stored value.
   */
  readonly upgradeState?: (state: unknown, ownerId: string) => State;
  /**
   * The version of the effect payloads its handlers enqueue. Each effect records it, so a pending
   * effect keeps the version it was recorded under across an upgrade and its target can map it.
   * It also enters every idempotency fingerprint, so a retry across a change is not a replay.
   */
  readonly contractVersion?: string;
  readonly handlers: readonly HandlerContribution<State, Services>[];
  /** Composed policy; every operation, row and event is authorized through it. */
  readonly authorization: AuthorizationPort<State>;
  readonly services?: Services;
  /**
   * UI selections an agent run may capture, as `kind → query operation`. The host validates each
   * selected `kind:id` through that query under the caller's own authority before capturing it.
   */
  readonly selectableResources?: Readonly<Record<string, string>>;
  /**
   * Sources for remote queries, by target (see `createRemoteSource`). Every authority built from
   * this definition shares them; they hold credentials access, never application state.
   */
  readonly sources?: Readonly<Record<string, RemoteSource>>;
  /** Wire systems of record and observers once the runtime exists. Called once per authority. */
  readonly connect?: (context: ConnectContext) => ApplicationConnections;
  /**
   * Server parts of the plugins the manifest lists, in the same order. `defineApplication`
   * folds their state slices, handlers and policies into this definition; the host opens their
   * lifecycles around the runtime (see `openPlugins`).
   */
  readonly plugins?: readonly AnyHostPlugin[];
}
// Definitions are stored and passed without their state type; the host is generic over it.
export type AnyApplicationDefinition = ApplicationDefinition<any, any>;

export interface ConnectContext {
  readonly application: HostedApplication;
  readonly workspaceId: string;
  /** The deployment's network port: integrations reach their declared destinations through it. */
  readonly network: NetworkPort;
  /** The deployment's process port: perception workers and drivers start through it. */
  readonly processes: ProcessPort;
  /**
   * Services of the composed plugins, keyed by plugin id, as handlers see them. A plugin that
   * owns long-lived resources (driver supervisors) exposes them here, so the application wires
   * them into its integrations without starting a second copy.
   */
  readonly services: Readonly<Record<string, unknown>>;
}

/** A long-running observer, such as a station screen bridge. */
export interface Observer {
  stop(): Promise<void>;
}

export interface ApplicationConnections {
  /** Systems of record the outbox delivers to and inbound sync pulls from. */
  readonly integrations?: readonly TargetIntegration<any>[];
  /**
   * Start observers. A serving host with background work enabled calls this once, after it
   * listens; the mobile authority calls it on each foreground after the previous observers
   * stopped; embedded authorities never do. A failed observation pass reports through `onError`
   * and is retried by the observer.
   */
  readonly observe?: (
    onError: (scope: string, error: unknown) => void,
  ) => Promise<readonly Observer[]>;
}

/**
 * Declare an application. Plugins are folded in here, so storage and the runtime see one state,
 * one handler list and one policy: each plugin's slice sits under its id, its handlers see only
 * that slice and its policy decides only its own operations and resource types.
 *
 * Fails at definition time when the plugins differ from the manifest's or are out of `requires`
 * order, or when a selectable resource names an operation the manifest does not compose, so a
 * typo cannot silently disable run context.
 */
export function defineApplication<State, Services = unknown>(
  definition: ApplicationDefinition<State, Services>,
): ApplicationDefinition<State, Services> {
  const plugins = definition.plugins ?? [];
  checkPlugins(definition.manifest.plugins ?? [], plugins);
  if (definition.migrations) checkMigrations('Application', definition.migrations);
  for (const plugin of plugins)
    if (plugin.state?.migrations)
      checkMigrations(`Plugin ${plugin.manifest.id}`, plugin.state.migrations);
  const operations = new Set(
    definition.manifest.modules.flatMap((module: CapabilityModule) =>
      module.capabilities.map((capability) => capability.id),
    ),
  );
  for (const [kind, operation] of Object.entries(definition.selectableResources ?? {}))
    if (!operations.has(operation))
      throw new Error(`Selectable resource "${kind}" names unknown operation "${operation}"`);
  if (!plugins.length) return Object.freeze(definition);
  return Object.freeze({
    ...definition,
    createState: composeCreateState(definition.createState, plugins) as (ownerId: string) => State,
    upgradeState: composeUpgradeState(definition.upgradeState, plugins) as (
      state: unknown,
      ownerId: string,
    ) => State,
    handlers: composeHandlers(definition.handlers, plugins) as HandlerContribution<
      State,
      Services
    >[],
    authorization: composeAuthorization(
      definition.authorization,
      plugins,
    ) as AuthorizationPort<State>,
  });
}

/**
 * Compose the definition into its runtime. HTTP, embedded MCP, CLI, mobile and tests all use this.
 * `hostComponents` are the platform's own requirements (see `HostPlatform.components`); they
 * appear in the catalog the runtime discovers. Without them it lists only the application's.
 */
export function createApplicationRuntime(
  definition: AnyApplicationDefinition,
  options: {
    storage: Storage<unknown>;
    services?: unknown;
    now?: () => number;
    newEffectId?: () => string;
    /** Audit sink; the host passes the event-log port a plugin provides, if any. */
    eventLog?: EventLogPort;
    hostComponents?: readonly HostComponent[];
    /** The blob store of each workspace; see `ApplicationOptions.blobStore`. */
    blobStore?: (workspaceId: string) => BlobStore | undefined;
  },
) {
  return createApplication({
    modules: definition.manifest.modules,
    components: deploymentComponents(definition.manifest, options.hostComponents),
    handlers: definition.handlers,
    storage: options.storage,
    authorization: definition.authorization,
    services: options.services ?? definition.services ?? {},
    ...(definition.sources ? { sources: definition.sources } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(definition.contractVersion ? { contractVersion: definition.contractVersion } : {}),
    ...(options.newEffectId ? { newEffectId: options.newEffectId } : {}),
    ...(options.eventLog ? { eventLog: options.eventLog } : {}),
    ...(options.blobStore ? { blobStore: options.blobStore } : {}),
  });
}
export type HostedApplication = ReturnType<typeof createApplicationRuntime>;

/** The identity the host uses for its own outbox reads; it never invokes business operations. */
export function hostContext(workspaceId: string): ExecutionContext {
  return { workspaceId, principalId: 'host' };
}

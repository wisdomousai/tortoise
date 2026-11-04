import {
  createApplication,
  type AuthorizationPort,
  type BlobStore,
  type ExecutionContext,
  type HandlerContribution,
  type RemoteSource,
  type Storage,
} from '@tortoise/runtime';
import type { CapabilityModule, EventLogPort, HostComponent } from '@tortoise/contracts';
import type { TargetIntegration } from '@tortoise/integration';
import type { BuildStamp } from './build';
import type { ApplicationManifest } from './manifest';
import { deploymentComponents } from './components';
import type { FeatureMount } from './feature';
import { checkUnits } from './features/check';
import {
  composeAuthorization,
  composeConnect,
  composeCreateState,
  composeHandlers,
  composeServices,
  composeSources,
  composeUpgradeState,
  featureComposition,
} from './features/compose';
import { composedUnits } from './features/units';
import type { AnyHostPlugin, FolderPort, NetworkPort, ProcessPort } from './plugin';
import type { StateMigrations } from './migrations';

/**
 * Everything the host needs to run one application, supplied by content. The host never
 * names a domain: it receives this value from the starter's configuration and composes runtime,
 * storage, integrations and observers from it.
 *
 * Trust boundary: a definition is trusted code. Its policy, handlers and connections run inside
 * the instance with the host's privileges; only callers are untrusted.
 */
export interface ApplicationDefinition<State, Services = unknown> {
  readonly manifest: ApplicationManifest;
  /** Fresh workspace state; `localUserId` is the local user principal. */
  readonly createState: (localUserId: string) => State;
  /**
   * Versions of the application's own state and the steps between them. Storage stamps each
   * workspace with the version it holds; see `stateUpgrade` and the `migrate` command.
   */
  readonly migrations?: StateMigrations;
  /**
   * Unversioned normalization of persisted state, run on every load after the migrations, such
   * as filling a field older workspaces lack. Defaults to keeping the stored value.
   */
  readonly upgradeState?: (state: unknown, localUserId: string) => State;
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
   * selected `kind:id` through that query with the caller's own grants and policy before capturing it.
   */
  readonly selectableResources?: Readonly<Record<string, string>>;
  /**
   * Sources for remote queries, by target (see `createRemoteSource`). Every instance built from
   * this definition shares them; they hold credentials access, never application state.
   * Deprecated: return sources from `connect`, which reaches them through the network port.
   */
  readonly sources?: Readonly<Record<string, RemoteSource>>;
  /** Wire systems of record and observers once the runtime exists. Called once per instance. */
  readonly connect?: (context: ConnectContext) => ApplicationConnections;
  /**
   * The features the manifest lists, mounted in the same order (see `mountFeature`).
   * `defineApplication` folds their slices, handlers, policies, services and connections into
   * this definition.
   */
  readonly features?: readonly FeatureMount<State>[];
  /**
   * Server parts of the plugins the manifest lists, in the same order. `defineApplication`
   * folds their state slices, handlers and policies into this definition; the host opens their
   * lifecycles around the runtime (see `openPlugins`).
   */
  readonly plugins?: readonly AnyHostPlugin[];
  /** When the running binary was built; set by `stampBuild`, never by hand. Absent from source. */
  readonly build?: BuildStamp;
}
// Definitions are stored and passed without their state type; the host is generic over it.
export type AnyApplicationDefinition = ApplicationDefinition<any, any>;

export interface ConnectContext {
  readonly application: HostedApplication;
  readonly workspaceId: string;
  /** The deployment's network port: integrations reach their declared destinations through it. */
  readonly network: NetworkPort;
  /** The deployment's process port: recognition workers and drivers start through it. */
  readonly processes: ProcessPort;
  /** The deployment's folder port: file connectors reach their declared folders through it. */
  readonly folders: FolderPort;
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
   * Sources for remote queries, by target, built from the ports this context offers. They are
   * bound into the runtime once per instance; a target that already has a source is refused.
   */
  readonly sources?: Readonly<Record<string, RemoteSource>>;
  /**
   * Start observers. A serving host with background work enabled calls this once, after it
   * listens; the mobile instance calls it on each foreground after the previous observers
   * stopped; embedded instances never do. A failed observation pass reports through `onError`
   * and is retried by the observer.
   */
  readonly observe?: (
    onError: (scope: string, error: unknown) => void,
  ) => Promise<readonly Observer[]>;
}

/**
 * Declare an application. Features and plugins are folded in here, so storage and the runtime
 * see one state, one handler list, one policy and one set of connections: each unit's slice sits
 * under its id, its handlers see only that slice and its policy decides only its own operations
 * and resource types.
 *
 * Fails at definition time when the features or plugins differ from the manifest's or are out
 * of `requires` order, when a migration chain or adoption is inconsistent, when a unit claims an
 * operation or resource type the application policy covers, or when a selectable resource names
 * an operation the manifest does not compose, so a typo cannot silently disable run context.
 */
export function defineApplication<State, Services = unknown>(
  definition: ApplicationDefinition<State, Services>,
): ApplicationDefinition<State, Services> {
  const units = composedUnits(definition);
  checkUnits(definition, units);
  const operations = new Set(
    definition.manifest.modules.flatMap((module: CapabilityModule) =>
      module.capabilities.map((capability) => capability.id),
    ),
  );
  for (const [kind, operation] of Object.entries(definition.selectableResources ?? {}))
    if (!operations.has(operation))
      throw new Error(`Selectable resource "${kind}" names unknown operation "${operation}"`);
  if (!units.length) return Object.freeze(definition);
  const sources = composeSources(definition.sources, units);
  const connect = composeConnect(definition.connect, units);
  const services = composeServices(definition.services, units);
  return Object.freeze({
    ...definition,
    createState: composeCreateState(definition.createState, units) as (
      localUserId: string,
    ) => State,
    upgradeState: composeUpgradeState(definition.upgradeState, units) as (
      state: unknown,
      localUserId: string,
    ) => State,
    handlers: composeHandlers(
      definition.handlers,
      units,
      featureComposition(definition.manifest.modules, units),
    ) as HandlerContribution<State, Services>[],
    authorization: composeAuthorization(
      definition.authorization,
      units,
    ) as AuthorizationPort<State>,
    ...(services === undefined ? {} : { services: services as Services }),
    ...(sources ? { sources } : {}),
    ...(connect ? { connect } : {}),
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
    id: definition.manifest.id,
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

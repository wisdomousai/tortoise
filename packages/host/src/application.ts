import {
  createApplication,
  type AuthorizationPort,
  type ExecutionContext,
  type HandlerContribution,
  type RemoteSource,
  type Storage,
} from '@agent-native/runtime';
import type { CapabilityModule, EventLogPort } from '@agent-native/contracts';
import type { TargetIntegration } from '@agent-native/integration';
import type { ApplicationManifest } from './manifest';
import { deploymentComponents } from './components';
import type { AnyHostPlugin, NetworkPort } from './plugin';
import {
  checkPlugins,
  composeAuthorization,
  composeCreateState,
  composeHandlers,
  composeUpgradeState,
} from './plugins/compose';

/**
 * Everything the host needs to run one application, supplied by content (P11). The host never
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
  /** Upgrade persisted state from earlier versions. Defaults to keeping the stored value. */
  readonly upgradeState?: (state: unknown, ownerId: string) => State;
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
}

/** A long-running observer, such as a station screen bridge. */
export interface Observer {
  stop(): Promise<void>;
}

export interface ApplicationConnections {
  /** Systems of record the outbox delivers to and inbound sync pulls from. */
  readonly integrations?: readonly TargetIntegration<any>[];
  /**
   * Start observers. Only a serving host with background work enabled calls this, after it
   * listens; embedded authorities never do. A failed observation pass reports through `onError`
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

/** Compose the definition into its runtime. HTTP, embedded MCP, CLI and tests all use this. */
export function createApplicationRuntime(
  definition: AnyApplicationDefinition,
  options: {
    storage: Storage<unknown>;
    services?: unknown;
    now?: () => number;
    newEffectId?: () => string;
    /** Audit sink; the host passes the event-log port a plugin provides, if any. */
    eventLog?: EventLogPort;
  },
) {
  return createApplication({
    modules: definition.manifest.modules,
    components: deploymentComponents(definition.manifest),
    handlers: definition.handlers,
    storage: options.storage,
    authorization: definition.authorization,
    services: options.services ?? definition.services ?? {},
    ...(definition.sources ? { sources: definition.sources } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.newEffectId ? { newEffectId: options.newEffectId } : {}),
    ...(options.eventLog ? { eventLog: options.eventLog } : {}),
  });
}
export type HostedApplication = ReturnType<typeof createApplicationRuntime>;

/** The identity the host uses for its own outbox reads; it never invokes business operations. */
export function hostContext(workspaceId: string): ExecutionContext {
  return { workspaceId, principalId: 'host' };
}

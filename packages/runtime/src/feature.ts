import type {
  AnyCapability,
  CapabilityModule,
  FeatureManifest,
  InputOf,
  JsonValue,
  OutputOf,
} from '@agent-native/contracts';
import type {
  AuthorizationRequest,
  ChangeEvent,
  Decision,
  ExecutionContext,
  HandlerContext,
  RemoteItemOf,
  RemoteSource,
} from './types.js';

/**
 * One step from state version `from` to `to`. `up` receives the slice as stored and returns it
 * in the new shape; it must be deterministic, because storage runs it on every load until a
 * commit persists the result.
 *
 * `compatible`: code at `from` still reads and writes the result, because the step only adds
 * optional data. A rollback past compatible steps is allowed; past any other step it is refused.
 */
export interface MigrationStep {
  readonly from: number;
  readonly to: number;
  readonly compatible?: boolean;
  up(state: unknown, ownerId: string): unknown;
}
/**
 * The versions of one state slice (an application's own state, a feature's or a plugin's).
 * `version` is what this code writes; `steps` chain contiguously up to it. State stored before
 * versioning counts as version 1.
 */
export interface StateMigrations {
  readonly version: number;
  readonly steps?: readonly MigrationStep[];
}

/** A feature's state slice, kept under the feature's id in the application's state. */
export interface FeatureState<Slice> {
  create(ownerId: string): Slice;
  /** Versions of this slice; see `StateMigrations`. */
  readonly migrations?: StateMigrations;
  /** Unversioned normalization run on every load after the migrations. */
  upgrade?(stored: unknown, ownerId: string): Slice;
}

/**
 * What a feature handler receives: the handler context over the feature's own slice, the access
 * view the mounting application computes from its state, and the hooks it supplied, bound to the
 * command's transaction. A hook may write application records, which commit with the command.
 */
export type FeatureHandlerContext<Slice, Services, Access, Hooks> = HandlerContext<
  Slice,
  Services
> & {
  readonly access: Access;
  readonly hooks: Hooks;
};

export interface FeatureHandler<
  Slice,
  Services = unknown,
  Access = unknown,
  Hooks = unknown,
  C extends AnyCapability = AnyCapability,
> {
  readonly capability: C;
  handle(
    input: InputOf<C>,
    context: FeatureHandlerContext<Slice, Services, Access, Hooks>,
  ): OutputOf<C> | Promise<OutputOf<C>>;
  /** Present exactly when the capability declares `remote`; see `RemoteHandler`. */
  readonly remote?: {
    request(
      input: InputOf<C>,
      context: FeatureHandlerContext<Slice, Services, Access, Hooks>,
    ): JsonValue;
    item(
      found: unknown,
      context: FeatureHandlerContext<Slice, Services, Access, Hooks>,
    ): RemoteItemOf<C> | undefined;
  };
}

type WithAccess<Request, Access> = Request & {
  readonly access: Access;
  /** The access view on the state before the command, at the `commit` phase. */
  readonly previousAccess?: Access;
};

/**
 * A feature's policy. It decides only the feature's own operations and resource types, over the
 * feature's slice and the access view, never over application state directly. An
 * `AuthorizationPort` over the slice is a valid feature policy that ignores `access`.
 */
export interface FeaturePolicy<Slice, Access = unknown> {
  authorize(request: WithAccess<AuthorizationRequest<Slice>, Access>): Decision | Promise<Decision>;
  projectOutput?(
    request: WithAccess<
      Omit<AuthorizationRequest<Slice>, 'phase'> & { readonly output: unknown },
      Access
    >,
  ): unknown | Promise<unknown>;
  canReadEvent(request: {
    readonly event: ChangeEvent;
    readonly context: ExecutionContext;
    readonly state: Slice;
    readonly access: Access;
  }): boolean | Promise<boolean>;
  canReadResource?(request: {
    readonly resource: string;
    readonly event: ChangeEvent;
    readonly context: ExecutionContext;
    readonly state: Slice;
    readonly access: Access;
  }): boolean | Promise<boolean>;
}

/** What a feature's handler list may depend on: every module of the composed manifest. */
export interface FeatureComposition {
  /** The application's own modules, then every feature's and plugin's. */
  readonly modules: readonly CapabilityModule[];
  /** The application's own modules only. */
  readonly applicationModules: readonly CapabilityModule[];
}

/**
 * The server part of a feature, without host concerns. The kernel's `Feature` adds `connect`, and
 * a host plugin is a feature with ports, a lifecycle and settings.
 */
export interface FeatureServer<Slice = any, Access = any, Hooks = any, Services = any> {
  readonly manifest: FeatureManifest;
  readonly state?: FeatureState<Slice>;
  readonly handlers?:
    | readonly FeatureHandler<Slice, Services, Access, Hooks>[]
    | ((
        composition: FeatureComposition,
      ) => readonly FeatureHandler<Slice, Services, Access, Hooks>[]);
  readonly authorization?: {
    readonly resourceTypes: readonly string[];
    readonly port: FeaturePolicy<Slice, Access>;
  };
  /** Exposed to every handler as `services[<id>]`. */
  readonly services?: unknown;
  /** Sources for the feature's own remote queries, by target. */
  readonly sources?: Readonly<Record<string, RemoteSource>>;
}

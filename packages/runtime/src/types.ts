import type {
  AnyCapability,
  AuditChannel,
  BlobRef,
  InputOf,
  OutputOf,
  JsonValue,
  RemoteReadDeclaration,
} from '@agent-native/contracts';
import type { Effect, EffectOutcome, EffectRequest } from './types/effects.js';

import type { StateVersions } from './types/state-versions.js';

export type * from './types/effects.js';
export type * from './types/state-versions.js';

export interface DelegationGrant {
  readonly operations: readonly string[];
  readonly expiresAt?: number;
  readonly resources?: readonly string[];
  /**
   * Record types a resource-scoped grant may create new records of, outside `resources`: a run
   * cannot name a record before it exists, such as the approval request a requesting agent submits. Only a
   * record with no revision yet counts; changing an existing one still needs `resources`.
   */
  readonly creates?: readonly string[];
  readonly principalId?: string;
  readonly workspaceId?: string;
  readonly runId?: string;
}
/** Supplied by a trusted host; transports must never construct this from tool arguments. */
export interface ExecutionContext {
  readonly workspaceId: string;
  readonly principalId: string;
  readonly grant?: DelegationGrant;
  readonly runId?: string;
  readonly signal?: AbortSignal;
  /** Surface that carried the request, for audit events. Set by the host adapter, never by callers. */
  readonly channel?: AuditChannel;
}
export interface ChangeEvent {
  readonly cursor: number;
  readonly resource: string;
  readonly revision: number;
  readonly type: string;
  readonly operation: string;
}
export interface CommandReceipt<T = unknown> {
  readonly operation: string;
  readonly result: T;
  readonly cursor: number;
  readonly authorizationRevision: number;
  readonly revisions: Readonly<Record<string, number>>;
  /** Outbox effect IDs committed with this command; present only when the command enqueued any. */
  readonly effects?: readonly string[];
  /** The command this one continued with (`continueWith`) and its result, projected for the caller. */
  readonly continuation?: { readonly operation: string; readonly result: unknown };
}
export interface StoredReceipt {
  readonly fingerprint: string;
  readonly receipt: CommandReceipt;
  readonly principalId: string;
  readonly input: JsonValue;
  /** The command this one continued with, and its input. */
  readonly continuation?: { readonly operation: string; readonly input: JsonValue };
}
/**
 * A blob the workspace holds and the resources that reference it. A blob is readable by a caller
 * who may read one of these resources, and it is kept while any resource references it.
 */
export interface BlobRecord {
  readonly size: number;
  readonly mediaType: string;
  /** Sorted, without duplicates; never empty (the record is removed with its last reference). */
  readonly resources: readonly string[];
}
/** Feature state is opaque to the kernel; repositories may wrap it without a universal record model. */
export interface WorkspaceSnapshot<State> {
  state: State;
  cursor: number;
  authorizationRevision: number;
  resourceRevisions: Record<string, number>;
  receipts: Record<string, StoredReceipt>;
  journal: ChangeEvent[];
  /** Transactional outbox. Storage adapters load documents without it as an empty record. */
  effects: Record<string, Effect>;
  /** Blob references by digest. Storage adapters load documents without it as an empty record. */
  blobs: Record<string, BlobRecord>;
  /**
   * The last journal cursor storage removed under its retention limit; entries up to it are
   * gone. A subscriber whose cursor is older gets a reset instead of a partial history.
   */
  journalFloor?: number;
  /** The version of each state slice; see `StateUpgrade`. Absent for state never versioned. */
  stateVersions?: StateVersions;
}
/** A successful callback atomically commits all fields. Rejected callbacks commit nothing. */
export interface Storage<State> {
  transact<T>(
    workspaceId: string,
    fn: (snapshot: WorkspaceSnapshot<State>) => Promise<T>,
  ): Promise<T>;
  read<T>(
    workspaceId: string,
    fn: (snapshot: Readonly<WorkspaceSnapshot<State>>) => Promise<T>,
  ): Promise<T>;
}
export interface AuthorizationRequest<State> {
  readonly capability: AnyCapability;
  readonly input: unknown;
  readonly context: ExecutionContext;
  readonly state: State;
  readonly previousState?: State;
  /**
   * `dispatch`: before an outbox effect is delivered, the actor who committed it is asked again,
   * as a person without the delegation the command ran under, with the command's input and the
   * current state. A denial holds the effect for reconciliation instead of sending it.
   */
  readonly phase: 'invoke' | 'commit' | 'replay' | 'dispatch';
}
export interface Decision {
  readonly allowed: boolean;
  readonly reason?: string;
}
export interface AuthorizationPort<State> {
  /**
   * The operations and journal resource types this port has rules for. Composition refuses a
   * feature or plugin that owns one of them, so a unit never silently shadows an application
   * rule. `definePolicy` and the composition helpers fill it; a port without it is not checked.
   */
  readonly covers?: {
    readonly operations?: readonly string[];
    readonly resourceTypes?: readonly string[];
  };
  /** Apply resource-grant scope to reads as well as writes; hosts also check persisted run revocation here. */
  authorize(request: AuthorizationRequest<State>): Decision | Promise<Decision>;
  projectOutput?(
    request: Omit<AuthorizationRequest<State>, 'phase'> & { readonly output: unknown },
  ): unknown | Promise<unknown>;
  canReadEvent(request: {
    readonly event: ChangeEvent;
    readonly context: ExecutionContext;
    readonly state: State;
  }): boolean | Promise<boolean>;
  /**
   * Whether the context may read a resource as it is now; it decides who may read the blobs
   * attached to it. Defaults to `canReadEvent` with `event`, a `blob.read` event for the
   * resource's current revision.
   */
  canReadResource?(request: {
    readonly resource: string;
    readonly event: ChangeEvent;
    readonly context: ExecutionContext;
    readonly state: State;
  }): boolean | Promise<boolean>;
}
/** A stored blob's size and when it was stored or last stored again. */
export interface StoredBlob {
  readonly size: number;
  readonly storedAt: number;
}
/**
 * Content-addressed bytes for one workspace, kept outside the snapshot. The runtime computes each
 * digest and decides what is referenced; a store only keeps bytes. `put` is atomic: a reader never
 * sees a partial blob. Storing bytes that are already present refreshes `storedAt`, so a fresh
 * upload is never swept. Trusted platform code; never reachable by callers directly.
 */
export interface BlobStore {
  put(digest: string, data: Uint8Array): Promise<void>;
  stat(digest: string): Promise<StoredBlob | undefined>;
  get(digest: string): Promise<Uint8Array | undefined>;
  remove(digest: string): Promise<void>;
  list(): Promise<readonly string[]>;
}
export interface HandlerContext<State, Services> {
  readonly state: State;
  readonly services: Services;
  readonly context: ExecutionContext;
  getRevision(resource: string): number;
  /** Register a changed resource. The runtime assigns its revision and journal cursor. */
  change(resource: string, eventType?: string): void;
  /** Invalidate discovery and protected caches in the same transaction as a policy change. */
  invalidateAuthorization(): void;
  /**
   * Queue an outbox effect in this command's transaction and return its stable ID. The effect's
   * resource must also be declared through `change`. Commands only; never call the target here.
   */
  enqueue(effect: EffectRequest): string;
  /**
   * Record a target's outcome for a pending effect inside an ordinary settlement command, so the
   * outcome commits with the domain update it causes. Settling twice fails with CONFLICT. A
   * dispatcher passes the fencing token of its claim; a token older than the effect's current
   * claim fails with CONFLICT. A reconciliation command by a person passes none.
   */
  settleEffect(id: string, outcome: EffectOutcome, attempt?: { readonly fence?: number }): Effect;
  /**
   * Withdraw a pending effect no worker ever claimed, so it is never sent; the domain command
   * updates its own record in the same transaction. Fails with CONFLICT once a worker claimed it,
   * because the target may then already have it.
   */
  cancelEffect(id: string, reason: string): Effect;
  /**
   * Return a held effect to delivery, inside the reconciliation command whose actor confirmed the
   * target did not apply it. Fails with CONFLICT unless the effect is pending and held.
   */
  releaseEffect(id: string): Effect;
  /**
   * After this handler returns, run one more command in the same transaction as the same caller,
   * for example the command of an approval request. It passes the whole command pipeline (grant,
   * invoke authorization, `expectedRevisions` as preconditions, its handler, output projection,
   * commit authorization and audit), so it can never do what the caller could not do directly.
   * Both commit together or neither does. Commands only; once per command; a continued command
   * cannot continue again.
   */
  continueWith(
    operation: string,
    input: unknown,
    expectedRevisions?: Readonly<Record<string, number>>,
  ): void;
  /** Read outbox state, for example to summarize synchronization in a query. */
  /**
   * Reference a blob from a changed resource, in this command's transaction. The command must
   * declare `blobs` limits the reference fits, and the resource must also be declared through
   * `change`. At commit the blob must be in the store with this size, and the caller must have
   * uploaded it recently or already be able to read a resource that references it; otherwise the
   * command fails with INVALID_INPUT and nothing commits.
   */
  attach(resource: string, ref: BlobRef): void;
  /** Drop a resource's reference to a blob; an unreferenced blob is later swept from the store. */
  detach(resource: string, digest: string): void;
  effects(filter?: {
    readonly status?: Effect['status'];
    readonly target?: string;
    /** `true` for held effects only, `false` to exclude them; all when omitted. */
    readonly held?: boolean;
  }): readonly Effect[];
}
export interface HandlerContribution<State, Services, C extends AnyCapability = AnyCapability> {
  readonly capability: C;
  handle(
    input: InputOf<C>,
    context: HandlerContext<State, Services>,
  ): OutputOf<C> | Promise<OutputOf<C>>;
  /** Present exactly when the capability declares `remote`; the runtime then never calls `handle`. */
  readonly remote?: RemoteHandler<State, Services, C>;
}
/** One item of a remote query's `items` output. */
export type RemoteItemOf<C> =
  OutputOf<C> extends { readonly items: readonly (infer I)[] } ? I : never;
/**
 * The pure parts of a remote query. Both run inside a read snapshot and must not perform I/O or
 * mutate state; the runtime calls the source between them, outside any transaction.
 */
export interface RemoteHandler<State, Services, C extends AnyCapability = AnyCapability> {
  /** Build the query sent to the source from validated input and local state. */
  request(input: InputOf<C>, context: HandlerContext<State, Services>): JsonValue;
  /**
   * Turn one item the source returned into an output item, for example marking records already
   * held locally, or drop it by returning `undefined`. Runs after the source answered, in a fresh
   * snapshot under a repeated authorization. Output projection and validation follow.
   */
  item(found: unknown, context: HandlerContext<State, Services>): RemoteItemOf<C> | undefined;
}
/** What a remote query asks its source: the operation and the query its handler built. */
export interface SourceRequest {
  readonly operation: string;
  readonly query: JsonValue;
}
export interface SourceCall {
  /** The caller. A source acts with this principal's credential in the target when it has one. */
  readonly context: ExecutionContext;
  /** What the capability permits; a source must not fall back to a service credential under `caller`. */
  readonly identity: RemoteReadDeclaration['identity'];
  /** Aborts on caller cancellation and at the runtime's deadline. */
  readonly signal: AbortSignal;
}
export interface SourceAnswer {
  readonly items: readonly unknown[];
  /** Opaque cursor of the next page (at most 512 characters); absent on the last page. */
  readonly next?: string;
  /** The credential the source acted with. */
  readonly identity: 'caller' | 'service';
}
/**
 * Port that answers remote queries for one target. It never writes application state. Throw an
 * `ApplicationError` with code `UNAVAILABLE` and a caller-safe message when the target cannot be
 * reached; an error that is not an `ApplicationError` is reported generically. Other codes reach
 * the caller as errors: `FORBIDDEN` when the caller has no credential for the target,
 * `INVALID_INPUT` for a page cursor the source does not accept from this caller.
 */
export interface RemoteSource {
  search(request: SourceRequest, call: SourceCall): Promise<SourceAnswer>;
}
export interface Invocation<I = unknown> {
  readonly operation: string;
  readonly input: I;
  readonly idempotencyKey?: string;
  readonly expectedRevisions?: Readonly<Record<string, number>>;
}
export interface QueryResult<T = unknown> {
  readonly data: T;
  readonly cursor: number;
  readonly authorizationRevision: number;
}
export interface EventBatch {
  readonly events: readonly ChangeEvent[];
  readonly cursor: number;
  readonly authorizationRevision: number;
  /** The cursor is older than the retained journal: reload instead of applying `events`. */
  readonly reset?: boolean;
}

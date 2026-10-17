import type {
  AnyCapability,
  AuditChannel,
  InputOf,
  OutputOf,
  JsonValue,
  RemoteReadDeclaration,
} from '@agent-native/contracts';

export interface DelegationGrant {
  readonly operations: readonly string[];
  readonly expiresAt?: number;
  readonly resources?: readonly string[];
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
/**
 * A post-commit request to an external system of record. It is committed atomically with the
 * command that enqueues it, so a rejected command never produces an effect and a committed one
 * cannot lose it. Delivery happens later, outside any transaction, at least once.
 */
export interface EffectRequest {
  readonly target: string;
  readonly type: string;
  readonly payload: JsonValue;
  /** A changed business resource the effect reports on. Its read policy governs delivery events. */
  readonly resource: string;
}
/** The system of record's answer. A rejection is business data, not a transport failure. */
export type EffectOutcome =
  | { readonly status: 'accepted'; readonly externalRef?: string }
  | { readonly status: 'rejected'; readonly code: string; readonly message: string };
export interface Effect extends EffectRequest {
  /** Stable for the life of the effect; dispatchers use it as the target's idempotency key. */
  readonly id: string;
  readonly operation: string;
  readonly principalId: string;
  readonly createdAt: number;
  readonly status: 'pending' | EffectOutcome['status'];
  readonly attempts: number;
  readonly lastAttemptAt?: number;
  /** Caller-safe, bounded transient failure text from the most recent delivery attempt. */
  readonly lastFailure?: string;
  readonly settledAt?: number;
  readonly outcome?: EffectOutcome;
  /**
   * Set while a pending effect awaits reconciliation: the target may or may not have applied it
   * (for example a screen procedure was interrupted), so redelivery could act twice. Dispatchers
   * skip held effects. A domain command resolves it with `settleEffect` (it was applied, or it was
   * refused) or `releaseEffect` (it was not applied; deliver again).
   */
  readonly heldAt?: number;
  /** Caller-safe, bounded reason for the hold. */
  readonly holdReason?: string;
}
export interface StoredReceipt {
  readonly fingerprint: string;
  readonly receipt: CommandReceipt;
  readonly principalId: string;
  readonly input: JsonValue;
  /** The command this one continued with, and its input. */
  readonly continuation?: { readonly operation: string; readonly input: JsonValue };
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
  readonly phase: 'invoke' | 'commit' | 'replay';
}
export interface Decision {
  readonly allowed: boolean;
  readonly reason?: string;
}
export interface AuthorizationPort<State> {
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
   * outcome commits with the domain update it causes. Settling twice fails with CONFLICT.
   */
  settleEffect(id: string, outcome: EffectOutcome): Effect;
  /**
   * Return a held effect to delivery, inside the reconciliation command whose actor confirmed the
   * target did not apply it. Fails with CONFLICT unless the effect is pending and held.
   */
  releaseEffect(id: string): Effect;
  /**
   * After this handler returns, run one more command in the same transaction as the same caller,
   * for example the command a proposal proposed. It passes the whole command pipeline (grant,
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
}

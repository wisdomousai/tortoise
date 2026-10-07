import type { AnyCapability, InputOf, OutputOf, JsonValue } from '@agent-native/contracts';

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
}
export interface StoredReceipt {
  readonly fingerprint: string;
  readonly receipt: CommandReceipt;
  readonly principalId: string;
  readonly input: JsonValue;
}
/** Feature state is opaque to the kernel; repositories may wrap it without a universal record model. */
export interface WorkspaceSnapshot<State> {
  state: State;
  cursor: number;
  authorizationRevision: number;
  resourceRevisions: Record<string, number>;
  receipts: Record<string, StoredReceipt>;
  journal: ChangeEvent[];
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
}
export interface HandlerContribution<State, Services, C extends AnyCapability = AnyCapability> {
  readonly capability: C;
  handle(
    input: InputOf<C>,
    context: HandlerContext<State, Services>,
  ): OutputOf<C> | Promise<OutputOf<C>>;
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

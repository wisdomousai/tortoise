import type {
  AuthorizationPort,
  AuthorizationRequest,
  ChangeEvent,
  Decision,
  ExecutionContext,
} from './types.js';

type Input = Readonly<Record<string, unknown>>;
type Phase = AuthorizationRequest<unknown>['phase'];

/** What an operation rule sees of one snapshot. */
export interface Access<State, Role extends string> {
  readonly state: State;
  readonly context: ExecutionContext;
  readonly input: Input;
  readonly kind: 'command' | 'query';
  readonly phase: Phase;
  /** The container the rule resolved, when it names one. */
  readonly container?: string;
  /** The caller's role in that container. */
  readonly role?: Role;
}

/**
 * How one operation is decided. Every function reads authoritative state, never caller claims,
 * and runs once per snapshot: at commit both the current and the proposed state must allow it.
 */
export interface OperationRule<State, Role extends string> {
  /**
   * The container (project, plant, station) the operation acts in, resolved from `state`. When
   * the rule names one, an unresolved container or a caller without a role there is denied.
   */
  readonly container?: (input: Input, state: State, phase: Phase) => string | undefined;
  /**
   * The resource a resource-limited grant must name, for example `lot:<id>`. Checked only when
   * the caller's grant lists resources; an unresolved resource is then denied.
   */
  readonly grant?: (input: Input, state: State) => string | undefined;
  /** Roles that may run a command. Any role may run a query or a replay. Any role when omitted. */
  readonly roles?: readonly Role[];
  /**
   * A further decision on one snapshot, after the container and role checks. Not asked at
   * `dispatch`: the recheck before an outbox effect is sent asks whether the actor still holds a
   * role there, not whether the command's preconditions still hold on the changed state.
   */
  readonly allow?: (access: Access<State, Role>) => boolean;
  /** People only: a delegated run (a caller with a grant or run) is refused. */
  readonly person?: boolean;
  /** `previous`: decide a commit on the state before the command only, as for a delete. */
  readonly commit?: 'both' | 'previous';
  /** Reason recorded with a denial; `RESOURCE_DENIED` when omitted. */
  readonly reason?: string;
}

/** An integration principal and the operations it may call. */
export interface IntegrationAllowlist<State> {
  /** Whether `principalId` is this allowlist's principal. */
  readonly is: (state: State, principalId: string) => boolean;
  readonly operations: readonly string[];
  /** A further check on an allowed call, for example a station bridge acting for its station only. */
  readonly allow?: (request: AuthorizationRequest<State>) => boolean;
  /** Journal events the principal may read; every event when omitted. */
  readonly events?: (event: ChangeEvent, state: State, principalId: string) => boolean;
}

/** Who may read events of one resource type: a container rule, or a function of the resource ID. */
export type EventRule<State> =
  | { readonly container: (id: string, state: State) => string | undefined }
  | ((id: string, state: State, context: ExecutionContext) => boolean);

export interface PolicySpec<State, Role extends string> {
  /** The caller's role in a container, from authoritative state. Needed by container rules. */
  readonly roleOf?: (state: State, principalId: string, container: string) => Role | undefined;
  /** Integration principals. An allowlist's principal may call only its operations. */
  readonly integrations?: readonly IntegrationAllowlist<State>[];
  /** Applied to every other caller before any operation rule, for example workspace membership. */
  readonly caller?: { readonly allow: (state: State, context: ExecutionContext) => boolean };
  /**
   * Every operation this policy decides. `open` lets any caller who passes `caller` run it, and
   * the handler scopes rows; `integration` admits only allowlists that list it. Anything else is denied.
   */
  readonly operations: Readonly<
    Record<string, OperationRule<State, Role> | 'open' | 'integration'>
  >;
  /** Journal visibility by resource type (`<type>:<id>`). An unlisted type is denied. */
  readonly events: Readonly<Record<string, EventRule<State>>>;
  readonly projectOutput?: AuthorizationPort<State>['projectOutput'];
}

const deny = (reason: string): Decision => ({ allowed: false, reason });
const ALLOW: Decision = { allowed: true };

/** A delegated run: an agent or job acting under a grant, never a person at a screen. */
export const isDelegated = (context: ExecutionContext) =>
  context.runId !== undefined || context.grant !== undefined;

/** Decide one snapshot against a scoped rule. */
function evaluate<State, Role extends string>(
  spec: PolicySpec<State, Role>,
  rule: OperationRule<State, Role>,
  request: AuthorizationRequest<State>,
  state: State,
): boolean {
  const input = (request.input ?? {}) as Input;
  const { context } = request;
  if (rule.grant && context.grant?.resources) {
    const resource = rule.grant(input, state);
    if (resource === undefined || !context.grant.resources.includes(resource)) return false;
  }
  let container: string | undefined;
  let role: Role | undefined;
  if (rule.container) {
    container = rule.container(input, state, request.phase);
    role =
      container === undefined ? undefined : spec.roleOf?.(state, context.principalId, container);
    if (role === undefined) return false;
    const reads = request.capability.kind === 'query' || request.phase === 'replay';
    if (!reads && rule.roles && !rule.roles.includes(role)) return false;
  }
  const kind = request.capability.kind;
  const access: Access<State, Role> = {
    state,
    context,
    input,
    kind,
    phase: request.phase,
    ...(container === undefined ? {} : { container }),
    ...(role === undefined ? {} : { role }),
  };
  return request.phase === 'dispatch' || !rule.allow || rule.allow(access);
}

/** Decide a caller that is no integration principal. */
function decideCaller<State, Role extends string>(
  spec: PolicySpec<State, Role>,
  rule: OperationRule<State, Role> | 'open',
  request: AuthorizationRequest<State>,
): Decision {
  if (spec.caller && !spec.caller.allow(request.state, request.context))
    return deny('NOT_A_MEMBER');
  const scoped = rule === 'open' ? {} : rule;
  if (scoped.person && isDelegated(request.context)) return deny('PERSON_ONLY');
  const snapshots =
    scoped.commit === 'previous' && request.phase === 'commit'
      ? [request.previousState]
      : [request.state, ...(request.previousState === undefined ? [] : [request.previousState])];
  // A missing previous state for a `previous` rule is a denial, never a pass.
  const allowed = snapshots.every(
    (snapshot) => snapshot !== undefined && evaluate(spec, scoped, request, snapshot),
  );
  return allowed ? ALLOW : deny(scoped.reason ?? 'RESOURCE_DENIED');
}

function eventVisible<State, Role extends string>(
  spec: PolicySpec<State, Role>,
  event: ChangeEvent,
  state: State,
  context: ExecutionContext,
): boolean {
  const allowlist = spec.integrations?.find((candidate) =>
    candidate.is(state, context.principalId),
  );
  if (allowlist)
    return allowlist.events ? allowlist.events(event, state, context.principalId) : true;
  if (spec.caller && !spec.caller.allow(state, context)) return false;
  const separator = event.resource.indexOf(':');
  if (separator <= 0) return false;
  const type = event.resource.slice(0, separator);
  const id = event.resource.slice(separator + 1);
  const rule = Object.hasOwn(spec.events, type) ? spec.events[type] : undefined;
  if (!rule) return false;
  if (typeof rule === 'function') return rule(id, state, context);
  const container = rule.container(id, state);
  return (
    container !== undefined && spec.roleOf?.(state, context.principalId, container) !== undefined
  );
}

/**
 * Compile a declarative policy into an `AuthorizationPort`. The order is fixed: an operation the
 * spec does not list is denied (`NO_POLICY`); an integration principal may call only its allowlist;
 * an `integration` operation is denied to everyone else (`INTEGRATION_ONLY`); then the caller
 * gate, the person-only check, the grant's resources, the container role and the rule's own
 * check run on the current state and, at commit, on the proposed state too.
 */
export function definePolicy<State, Role extends string = string>(
  spec: PolicySpec<State, Role>,
): AuthorizationPort<State> {
  for (const allowlist of spec.integrations ?? [])
    for (const operation of allowlist.operations)
      if (!Object.hasOwn(spec.operations, operation))
        throw new Error(
          `Integration allowlist names an operation the policy does not: ${operation}`,
        );
  return {
    covers: {
      operations: Object.keys(spec.operations),
      resourceTypes: Object.keys(spec.events),
    },
    authorize(request) {
      const id = request.capability.id;
      const rule = Object.hasOwn(spec.operations, id) ? spec.operations[id] : undefined;
      if (!rule) return deny('NO_POLICY');
      const allowlist = spec.integrations?.find((candidate) =>
        candidate.is(request.state, request.context.principalId),
      );
      if (allowlist)
        return allowlist.operations.includes(id) && (!allowlist.allow || allowlist.allow(request))
          ? ALLOW
          : deny('INTEGRATION_SCOPE');
      if (rule === 'integration') return deny('INTEGRATION_ONLY');
      return decideCaller(spec, rule, request);
    },
    ...(spec.projectOutput ? { projectOutput: spec.projectOutput } : {}),
    canReadEvent: ({ event, state, context }) => eventVisible(spec, event, state, context),
  };
}

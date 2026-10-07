import { createHash } from 'node:crypto';
import {
  ApplicationError,
  buildCatalog,
  canonicalJson,
  assertJson,
  type AnyCapability,
  type AuditEvent,
  type AuditRecord,
  type AuditRequirement,
  type EventLogPort,
  type JsonObject,
  type CapabilityModule,
  type CapabilitiesOf,
  type CapabilityById,
  type InputOf,
  type OutputOf,
  type JsonValue,
} from '@agent-native/contracts';
import type {
  AuthorizationPort,
  CommandReceipt,
  Effect,
  EffectOutcome,
  EffectRequest,
  ExecutionContext,
  HandlerContribution,
  HandlerContext,
  Invocation,
  QueryResult,
  Storage,
  WorkspaceSnapshot,
  EventBatch,
} from './types.js';
import { sameState } from './state-equality.js';
export * from './types.js';
export * from './compose.js';

export function createWorkspaceSnapshot<State>(state: State): WorkspaceSnapshot<State> {
  return {
    state: structuredClone(state),
    cursor: 0,
    authorizationRevision: 0,
    resourceRevisions: {},
    receipts: {},
    journal: [],
    effects: {},
  };
}

/** Reference adapter. Serial callbacks and isolated copies model the same atomic boundary as durable adapters. */
export function createMemoryStorage<State>(
  initial: State | ((workspaceId: string) => State),
): Storage<State> {
  const workspaces = new Map<string, WorkspaceSnapshot<State>>();
  const tails = new Map<string, Promise<void>>();
  async function locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = tails.get(id) ?? Promise.resolve();
    let unlock!: () => void;
    const tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    tails.set(id, tail);
    await previous;
    try {
      return await action();
    } finally {
      unlock();
      if (tails.get(id) === tail) tails.delete(id);
    }
  }
  const get = (id: string): WorkspaceSnapshot<State> => {
    let value = workspaces.get(id);
    if (!value) {
      value = createWorkspaceSnapshot(
        typeof initial === 'function' ? (initial as (id: string) => State)(id) : initial,
      );
      workspaces.set(id, value);
    }
    return value;
  };
  return {
    transact: (id, fn) =>
      locked(id, async () => {
        const draft = structuredClone(get(id));
        const result = await fn(draft);
        const committed = structuredClone(draft);
        const isolatedResult = structuredClone(result);
        workspaces.set(id, committed);
        return isolatedResult;
      }),
    read: (id, fn) => locked(id, async () => structuredClone(await fn(structuredClone(get(id))))),
  };
}

/** Bind typed handler contributions without erasing each capability's input and output literals. */
export function createHandlerFactory<State, Services>() {
  return <C extends AnyCapability>(
    capability: C,
    handle: HandlerContribution<State, Services, C>['handle'],
  ): HandlerContribution<State, Services, C> => ({ capability, handle });
}

export interface ApplicationOptions<State, Services, Modules extends readonly CapabilityModule[]> {
  readonly modules: Modules;
  readonly handlers: readonly HandlerContribution<State, Services>[];
  readonly storage: Storage<State>;
  readonly authorization: AuthorizationPort<State>;
  readonly services: Services;
  readonly now?: () => number;
  readonly contractVersion?: string;
  /** Outbox effect identifiers; they must be globally unique because targets deduplicate by them. */
  readonly newEffectId?: () => string;
  /**
   * Audit sink. When present, every command, query, denial, outbox transition and delivery
   * attempt is recorded. Its `mode` decides whether an unwritable log blocks the action.
   */
  readonly eventLog?: EventLogPort;
}

/** Bounded, framework-generated error text; free text from handlers never reaches the log. */
const safeMessage = (error: unknown) =>
  error instanceof ApplicationError ? error.message.slice(0, 200) : 'Unexpected failure';

/** Compose pure capability definitions with private host implementations. No transport owns business execution. */
export function createApplication<
  State,
  Services,
  const Modules extends readonly CapabilityModule[],
>(options: ApplicationOptions<State, Services, Modules>) {
  const catalog = buildCatalog(options.modules);
  const capabilities = new Map(
    options.modules
      .flatMap((module) => module.capabilities)
      .map((capability) => [capability.id, capability]),
  );
  const handlers = new Map<string, HandlerContribution<State, Services>>();
  for (const handler of options.handlers) {
    if (capabilities.get(handler.capability.id) !== handler.capability)
      throw new Error(`Handler does not reference registered capability: ${handler.capability.id}`);
    if (handlers.has(handler.capability.id))
      throw new Error(`Duplicate handler: ${handler.capability.id}`);
    handlers.set(handler.capability.id, handler);
  }
  for (const id of capabilities.keys())
    if (!handlers.has(id)) throw new Error(`Missing handler: ${id}`);
  const now = options.now ?? Date.now;
  const newEffectId = options.newEffectId ?? (() => crypto.randomUUID());
  const eventLog = options.eventLog;
  /**
   * Append audit records. In `required` mode a failed append throws UNAVAILABLE so the caller
   * aborts; in `best-effort` mode it is swallowed and the gap shows up in verification instead.
   */
  async function audit(requirement: AuditRequirement, records: readonly AuditRecord[]) {
    if (!eventLog || records.length === 0) return;
    try {
      await eventLog.append(records);
    } catch {
      if (requirement === 'required')
        throw new ApplicationError('UNAVAILABLE', 'Audit log unavailable');
    }
  }
  /** Audit after an action already took effect: it cannot be undone, so never throw. */
  const auditAfter = (records: readonly AuditRecord[]) =>
    audit('best-effort', records).catch(() => undefined);
  const actorOf = (context: ExecutionContext) => ({
    principalId: context.principalId,
    workspaceId: context.workspaceId,
    ...(context.runId === undefined ? {} : { runId: context.runId }),
    ...(context.channel === undefined ? {} : { via: context.channel }),
  });
  /**
   * Inputs are logged as a digest plus field names. Only fields the capability allow-lists in
   * `audit.fields` appear in plain text. A digest of a low-entropy input can be guessed, so the
   * log itself remains confidential.
   */
  const describeInput = (capability: AnyCapability, input: unknown) => {
    const object =
      input !== null && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : undefined;
    const allowed = Object.fromEntries(
      (capability.audit?.fields ?? [])
        .filter((field) => object && Object.hasOwn(object, field))
        .map((field) => [field, object![field]]),
    ) as JsonObject;
    return {
      inputDigest: createHash('sha256').update(canonicalJson(input)).digest('hex'),
      data: {
        fields: object ? Object.keys(object).sort() : [],
        ...(Object.keys(allowed).length ? { values: allowed } : {}),
      } as JsonObject,
    };
  };
  const failureRecord = (
    kind: 'command' | 'query',
    operation: string,
    context: ExecutionContext,
    correlationId: string,
    error: unknown,
  ): AuditRecord => {
    const code = error instanceof ApplicationError ? error.code : 'INTERNAL';
    return {
      kind: `${kind}.${code === 'FORBIDDEN' ? 'denied' : 'failed'}`,
      outcome: code === 'FORBIDDEN' ? 'denied' : 'failed',
      operation,
      actor: actorOf(context),
      correlationId,
      reason: code,
      data: { message: safeMessage(error) },
    };
  };
  const effectRecords = (
    effects: readonly Effect[],
    context: ExecutionContext,
    correlationId: string,
  ): AuditRecord[] =>
    effects.map((effect) => ({
      // Enqueued effects have no attempts yet; a held effect always has one, so a pending effect
      // with attempts that a command touched was released.
      kind:
        effect.status !== 'pending'
          ? 'effect.settled'
          : effect.attempts === 0
            ? 'effect.enqueued'
            : 'effect.released',
      outcome: 'info',
      operation: effect.operation,
      resources: [effect.resource],
      actor: actorOf(context),
      correlationId,
      data: {
        effectId: effect.id,
        target: effect.target,
        type: effect.type,
        ...(effect.outcome ? { status: effect.outcome.status } : {}),
        ...(effect.outcome?.status === 'rejected' ? { code: effect.outcome.code } : {}),
      },
    }));
  const ownEffect = (snapshot: WorkspaceSnapshot<State>, id: string): Effect | undefined =>
    Object.hasOwn(snapshot.effects, id) ? snapshot.effects[id] : undefined;
  // Defined properties keep untrusted identifiers such as "__proto__" from touching prototypes.
  const putEffect = (snapshot: WorkspaceSnapshot<State>, effect: Effect): void => {
    Object.defineProperty(snapshot.effects, effect.id, {
      value: effect,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  };
  const text = (value: unknown, max: number): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= max;
  function validOutcome(outcome: EffectOutcome): EffectOutcome {
    if (
      outcome?.status === 'accepted' &&
      (outcome.externalRef === undefined || text(outcome.externalRef, 256))
    )
      return outcome.externalRef === undefined
        ? { status: 'accepted' }
        : { status: 'accepted', externalRef: outcome.externalRef };
    if (outcome?.status === 'rejected' && text(outcome.code, 128) && text(outcome.message, 2000))
      return { status: 'rejected', code: outcome.code, message: outcome.message };
    throw new ApplicationError('INVALID_INPUT', 'Invalid effect outcome');
  }
  const revisionOf = (snapshot: WorkspaceSnapshot<State>, resource: string): number =>
    Object.hasOwn(snapshot.resourceRevisions, resource) ? snapshot.resourceRevisions[resource]! : 0;
  function trusted(context: ExecutionContext): void {
    if (!context.workspaceId || !context.principalId)
      throw new ApplicationError('FORBIDDEN', 'Trusted workspace and principal required');
    if (context.signal?.aborted) throw new ApplicationError('CANCELLED', 'Execution cancelled');
    if (
      context.grant &&
      ((context.grant.principalId !== undefined &&
        context.grant.principalId !== context.principalId) ||
        (context.grant.workspaceId !== undefined &&
          context.grant.workspaceId !== context.workspaceId) ||
        (context.grant.runId !== undefined && context.grant.runId !== context.runId))
    )
      throw new ApplicationError('FORBIDDEN', 'Delegation is bound to another execution context');
    if (
      context.grant?.expiresAt !== undefined &&
      (!Number.isFinite(context.grant.expiresAt) || context.grant.expiresAt <= now())
    )
      throw new ApplicationError('FORBIDDEN', 'Delegation expired');
  }
  function active(context: ExecutionContext, operation: string): void {
    trusted(context);
    if (context.grant && !context.grant.operations.includes(operation))
      throw new ApplicationError('FORBIDDEN', 'Delegation does not permit operation');
  }
  function resolve(request: Invocation, kind: 'command' | 'query') {
    const capability = capabilities.get(request.operation);
    if (!capability || capability.kind !== kind)
      throw new ApplicationError('NOT_FOUND', `Unknown ${kind}`);
    let input: unknown;
    try {
      input = capability.input.parse(request.input);
    } catch {
      throw new ApplicationError('INVALID_INPUT', 'Input does not match operation schema');
    }
    return { capability, input, handler: handlers.get(capability.id)! };
  }
  async function authorize(
    capability: AnyCapability,
    input: unknown,
    context: ExecutionContext,
    snapshot: WorkspaceSnapshot<State>,
    phase: 'invoke' | 'commit' | 'replay',
    previousState?: State,
  ) {
    active(context, capability.id);
    const decision = await options.authorization.authorize({
      capability,
      input,
      context,
      state: snapshot.state,
      phase,
      ...(previousState === undefined ? {} : { previousState }),
    });
    active(context, capability.id);
    if (!decision.allowed)
      throw new ApplicationError('FORBIDDEN', decision.reason ?? 'Operation denied');
  }
  async function project(
    capability: AnyCapability,
    input: unknown,
    context: ExecutionContext,
    snapshot: WorkspaceSnapshot<State>,
    output: unknown,
  ) {
    const visible = options.authorization.projectOutput
      ? await options.authorization.projectOutput({
          capability,
          input,
          context,
          state: snapshot.state,
          output,
        })
      : output;
    try {
      return capability.output.parse(visible);
    } catch {
      throw new ApplicationError('INVALID_OUTPUT', 'Output does not match operation schema');
    }
  }
  const makeContext = (
    snapshot: WorkspaceSnapshot<State>,
    context: ExecutionContext,
    changes: Map<string, string>,
    query: boolean,
    operation: string,
    touchedEffects: Effect[] = [],
  ): HandlerContext<State, Services> => ({
    state: snapshot.state,
    services: options.services,
    context,
    getRevision: (resource) => revisionOf(snapshot, resource),
    invalidateAuthorization() {
      if (query) throw new ApplicationError('INTERNAL', 'Queries cannot invalidate authorization');
      snapshot.authorizationRevision++;
    },
    change(resource, type = 'changed') {
      if (query) throw new ApplicationError('INTERNAL', 'Queries cannot register changes');
      if (!resource)
        throw new ApplicationError('INTERNAL', 'Changed resource must have an identifier');
      if (context.grant?.resources && !context.grant.resources.includes(resource))
        throw new ApplicationError('FORBIDDEN', 'Delegation does not permit changed resource');
      changes.set(resource, type);
    },
    enqueue(request: EffectRequest) {
      if (query) throw new ApplicationError('INTERNAL', 'Queries cannot enqueue effects');
      if (!text(request?.target, 128) || !text(request.type, 128) || !text(request.resource, 512))
        throw new ApplicationError('INTERNAL', 'Effect requires target, type and resource');
      try {
        assertJson(request.payload);
      } catch {
        throw new ApplicationError('INTERNAL', 'Effect payload must be JSON');
      }
      const id = newEffectId();
      if (!text(id, 256) || ownEffect(snapshot, id))
        throw new ApplicationError('INTERNAL', 'Effect identifier is unavailable');
      const effect: Effect = {
        id,
        target: request.target,
        type: request.type,
        resource: request.resource,
        payload: structuredClone(request.payload),
        operation,
        principalId: context.principalId,
        createdAt: now(),
        status: 'pending',
        attempts: 0,
      };
      putEffect(snapshot, effect);
      touchedEffects.push(effect);
      return id;
    },
    settleEffect(id: string, outcome: EffectOutcome) {
      if (query) throw new ApplicationError('INTERNAL', 'Queries cannot settle effects');
      const effect = ownEffect(snapshot, id);
      if (!effect) throw new ApplicationError('NOT_FOUND', 'Effect unavailable');
      if (effect.status !== 'pending')
        throw new ApplicationError('CONFLICT', 'Effect already settled');
      // Held is a sub-state of pending: a settled effect no longer awaits reconciliation.
      const { heldAt: _heldAt, holdReason: _holdReason, ...unheld } = effect;
      const settled: Effect = {
        ...unheld,
        status: validOutcome(outcome).status,
        outcome: validOutcome(outcome),
        settledAt: now(),
      };
      putEffect(snapshot, settled);
      touchedEffects.push(settled);
      return structuredClone(settled);
    },
    releaseEffect(id: string) {
      if (query) throw new ApplicationError('INTERNAL', 'Queries cannot release effects');
      const effect = ownEffect(snapshot, id);
      if (!effect) throw new ApplicationError('NOT_FOUND', 'Effect unavailable');
      if (effect.status !== 'pending' || effect.heldAt === undefined)
        throw new ApplicationError('CONFLICT', 'Effect is not held');
      // Clearing the attempt clock lets the dispatcher deliver on its next pass, without backoff.
      const { heldAt: _heldAt, holdReason: _holdReason, lastAttemptAt: _last, ...rest } = effect;
      const released: Effect = rest;
      putEffect(snapshot, released);
      touchedEffects.push(released);
      return structuredClone(released);
    },
    effects(filter = {}) {
      return structuredClone(
        Object.values(snapshot.effects)
          .filter(
            (effect) =>
              (filter.status === undefined || effect.status === filter.status) &&
              (filter.target === undefined || effect.target === filter.target) &&
              (filter.held === undefined || (effect.heldAt !== undefined) === filter.held),
          )
          .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      );
    },
  });

  /**
   * Audit ordering for commands:
   * 1. Refusals and failures are recorded after the transaction has rolled back.
   * 2. `command.accepted` is appended inside the transaction, after the final commit-phase
   *    authorization and before the callback returns. If the log is required and the append
   *    fails, the callback throws UNAVAILABLE and storage commits nothing.
   * 3. `command.committed` and outbox events are appended after the commit. A crash between 2
   *    and 3 leaves an accepted event without an outcome; `recoverAudit` resolves it against the
   *    journal on the next start.
   * The append in step 2 is local, fsynced file I/O under the storage lock, never a network call.
   */
  async function invokeRaw(
    request: Invocation,
    context: ExecutionContext,
  ): Promise<CommandReceipt> {
    const correlationId = crypto.randomUUID();
    const operation = typeof request?.operation === 'string' ? request.operation : '';
    let transitions: Effect[] = [];
    let replayed = false;
    try {
      const receipt = await invokeCommand(request, context, correlationId, (effects, replay) => {
        transitions = effects;
        replayed = replay;
      });
      await auditAfter([
        {
          kind: replayed ? 'command.replayed' : 'command.committed',
          outcome: 'committed',
          operation,
          actor: actorOf(context),
          correlationId,
          cursor: receipt.cursor,
          resources: Object.keys(receipt.revisions).sort(),
        },
        ...effectRecords(transitions, context, correlationId),
      ]);
      return receipt;
    } catch (error) {
      if (eventLog)
        await auditAfter([failureRecord('command', operation, context, correlationId, error)]);
      throw error;
    }
  }
  async function invokeCommand(
    request: Invocation,
    context: ExecutionContext,
    correlationId: string,
    report: (effects: Effect[], replay: boolean) => void,
  ): Promise<CommandReceipt> {
    const { capability, input, handler } = resolve(request, 'command');
    active(context, capability.id);
    if (
      request.idempotencyKey !== undefined &&
      (typeof request.idempotencyKey !== 'string' ||
        !request.idempotencyKey ||
        request.idempotencyKey.length > 256)
    )
      throw new ApplicationError('INVALID_INPUT', 'Invalid idempotency key');
    const expected = request.expectedRevisions ?? {};
    if (
      typeof expected !== 'object' ||
      Array.isArray(expected) ||
      Object.getPrototypeOf(expected) !== Object.prototype
    )
      throw new ApplicationError('INVALID_INPUT', 'Expected revisions must be an object');
    if (Object.values(expected).some((revision) => !Number.isSafeInteger(revision) || revision < 0))
      throw new ApplicationError('INVALID_INPUT', 'Invalid expected revision');
    const grant = context.grant
      ? {
          operations: [...context.grant.operations].sort(),
          resources: context.grant.resources ? [...context.grant.resources].sort() : null,
          expiresAt: context.grant.expiresAt ?? null,
          principalId: context.grant.principalId ?? null,
          workspaceId: context.grant.workspaceId ?? null,
          runId: context.grant.runId ?? null,
        }
      : null;
    const fingerprint = canonicalJson({
      contractVersion: options.contractVersion ?? '1.0.0',
      operation: capability.id,
      input,
      expectedRevisions: expected,
      runId: context.runId ?? null,
      grant,
    });
    const key =
      request.idempotencyKey === undefined
        ? undefined
        : canonicalJson([context.principalId, request.idempotencyKey]);
    return options.storage.transact(context.workspaceId, async (snapshot) => {
      const stored = key === undefined ? undefined : snapshot.receipts[key];
      if (stored) {
        await authorize(capability, input, context, snapshot, 'replay');
        if (stored.fingerprint !== fingerprint)
          throw new ApplicationError(
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key was used for another request',
          );
        const result = await project(capability, input, context, snapshot, stored.receipt.result);
        await authorize(capability, input, context, snapshot, 'replay');
        report([], true);
        return { ...stored.receipt, result, authorizationRevision: snapshot.authorizationRevision };
      }
      await authorize(capability, input, context, snapshot, 'invoke');
      for (const [resource, revision] of Object.entries(expected))
        if (revisionOf(snapshot, resource) !== revision)
          throw new ApplicationError('CONFLICT', 'Resource revision changed', { resource });
      const previousState = structuredClone(snapshot.state);
      const previousAuthorizationRevision = snapshot.authorizationRevision;
      const changes = new Map<string, string>();
      const touchedEffects: Effect[] = [];
      const output = await handler.handle(
        input,
        makeContext(snapshot, context, changes, false, capability.id, touchedEffects),
      );
      // Outbox writes ride on a declared business change so subscribers observe the same commit.
      if (touchedEffects.some((effect) => !changes.has(effect.resource)))
        throw new ApplicationError('INTERNAL', 'Effects require a declared changed resource');
      if (
        changes.size === 0 &&
        snapshot.authorizationRevision === previousAuthorizationRevision &&
        !sameState(previousState, snapshot.state)
      )
        throw new ApplicationError(
          'INTERNAL',
          'State changes require a change-journal declaration',
        );
      const result = await project(capability, input, context, snapshot, output);
      await authorize(capability, input, context, snapshot, 'commit', previousState);
      active(context, capability.id);
      const revisions: Record<string, number> = {};
      for (const [resource, type] of [...changes].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      )) {
        const revision = revisionOf(snapshot, resource) + 1;
        Object.defineProperty(snapshot.resourceRevisions, resource, {
          value: revision,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        Object.defineProperty(revisions, resource, {
          value: revision,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        snapshot.journal.push({
          cursor: ++snapshot.cursor,
          resource,
          revision,
          type,
          operation: capability.id,
        });
        if (type === 'authorization.changed') snapshot.authorizationRevision++;
      }
      const receipt: CommandReceipt = {
        operation: capability.id,
        result,
        cursor: snapshot.cursor,
        authorizationRevision: snapshot.authorizationRevision,
        revisions,
        ...(touchedEffects.some((effect) => effect.status === 'pending')
          ? {
              effects: touchedEffects
                .filter((effect) => effect.status === 'pending')
                .map((effect) => effect.id),
            }
          : {}),
      };
      if (key !== undefined) {
        assertJson(input);
        snapshot.receipts[key] = {
          fingerprint,
          receipt: structuredClone(receipt),
          principalId: context.principalId,
          input: input as JsonValue,
        };
      }
      // Last step inside the transaction: nothing commits unless this append is durable (when
      // required). `fromCursor` lets recovery find this command's journal entries.
      const described = describeInput(capability, input);
      await audit(eventLog?.mode.commands ?? 'best-effort', [
        {
          kind: 'command.accepted',
          outcome: 'accepted',
          operation: capability.id,
          actor: actorOf(context),
          correlationId,
          cursor: snapshot.cursor,
          resources: Object.keys(revisions).sort(),
          inputDigest: described.inputDigest,
          data: {
            ...described.data,
            fromCursor: snapshot.cursor - changes.size,
            ...(request.idempotencyKey === undefined
              ? {}
              : { idempotencyKey: request.idempotencyKey }),
          },
        },
      ]);
      report(touchedEffects, false);
      return receipt;
    });
  }
  /**
   * Queries are audited after the read: `query.executed` must be durable before data is returned
   * when the log is required for queries. Refusals are recorded as `query.denied`.
   */
  async function queryRaw(request: Invocation, context: ExecutionContext): Promise<QueryResult> {
    const correlationId = crypto.randomUUID();
    const operation = typeof request?.operation === 'string' ? request.operation : '';
    let result: QueryResult;
    let inputDigest: string | undefined;
    try {
      result = await readQuery(request, context, (digest) => (inputDigest = digest));
    } catch (error) {
      if (eventLog)
        await auditAfter([failureRecord('query', operation, context, correlationId, error)]);
      throw error;
    }
    await audit(eventLog?.mode.queries ?? 'best-effort', [
      {
        kind: 'query.executed',
        outcome: 'allowed',
        operation,
        actor: actorOf(context),
        correlationId,
        cursor: result.cursor,
        ...(inputDigest ? { inputDigest } : {}),
      },
    ]);
    return result;
  }
  async function readQuery(
    request: Invocation,
    context: ExecutionContext,
    describe: (inputDigest: string) => void,
  ): Promise<QueryResult> {
    const { capability, input, handler } = resolve(request, 'query');
    active(context, capability.id);
    if (eventLog) describe(describeInput(capability, input).inputDigest);
    return options.storage.read(context.workspaceId, async (readonlySnapshot) => {
      const snapshot = structuredClone(readonlySnapshot);
      await authorize(capability, input, context, snapshot, 'invoke');
      const before = structuredClone(snapshot.state);
      const output = await handler.handle(
        input,
        makeContext(snapshot, context, new Map(), true, capability.id),
      );
      if (!sameState(snapshot.state, before))
        throw new ApplicationError('INTERNAL', 'Query mutated feature state');
      const result = await project(capability, input, context, snapshot, output);
      await authorize(capability, input, context, snapshot, 'invoke');
      active(context, capability.id);
      return {
        data: result,
        cursor: snapshot.cursor,
        authorizationRevision: snapshot.authorizationRevision,
      };
    });
  }
  type Command = Extract<CapabilitiesOf<Modules>, { kind: 'command' }>;
  type Query = Extract<CapabilitiesOf<Modules>, { kind: 'query' }>;
  function invoke<Id extends Command['id']>(
    request: Invocation<InputOf<CapabilityById<Command, Id>>> & { readonly operation: Id },
    context: ExecutionContext,
  ): Promise<CommandReceipt<OutputOf<CapabilityById<Command, Id>>>> {
    return invokeRaw(request, context) as Promise<
      CommandReceipt<OutputOf<CapabilityById<Command, Id>>>
    >;
  }
  function query<Id extends Query['id']>(
    request: Invocation<InputOf<CapabilityById<Query, Id>>> & { readonly operation: Id },
    context: ExecutionContext,
  ): Promise<QueryResult<OutputOf<CapabilityById<Query, Id>>>> {
    return queryRaw(request, context) as Promise<QueryResult<OutputOf<CapabilityById<Query, Id>>>>;
  }
  async function eventBatch(
    snapshot: Readonly<WorkspaceSnapshot<State>>,
    after: number,
    context: ExecutionContext,
  ): Promise<EventBatch> {
    if (!Number.isSafeInteger(after) || after < 0)
      throw new ApplicationError('INVALID_INPUT', 'Invalid event cursor');
    trusted(context);
    if (after > snapshot.cursor)
      throw new ApplicationError('CONFLICT', 'Event cursor requires a fresh snapshot');
    const events = [];
    for (const event of snapshot.journal)
      if (
        event.cursor > after &&
        (!context.grant ||
          (context.grant.operations.includes(event.operation) &&
            (context.grant.expiresAt === undefined || context.grant.expiresAt > now()) &&
            (!context.grant.resources || context.grant.resources.includes(event.resource)))) &&
        (await options.authorization.canReadEvent({ event, context, state: snapshot.state }))
      )
        events.push(event);
    trusted(context);
    return {
      events,
      cursor: snapshot.cursor,
      authorizationRevision: snapshot.authorizationRevision,
    };
  }
  async function events(after: number, context: ExecutionContext): Promise<EventBatch> {
    trusted(context);
    return options.storage.read(context.workspaceId, (snapshot) =>
      eventBatch(snapshot, after, context),
    );
  }
  /** Enqueue authorized delivery synchronously while the read boundary excludes local revocation commits. */
  async function deliverEvents(
    after: number,
    context: ExecutionContext,
    deliver: (batch: EventBatch) => void,
  ): Promise<void> {
    trusted(context);
    await options.storage.read(context.workspaceId, async (snapshot) => {
      const batch = await eventBatch(snapshot, after, context);
      const result: unknown = deliver(batch);
      if (result && typeof (result as { then?: unknown }).then === 'function')
        throw new ApplicationError('INTERNAL', 'Event delivery callback must be synchronous');
    });
  }
  /**
   * Host-only outbox read for a trusted dispatcher. Transports must not expose it: payloads are
   * unprojected. Business visibility of synchronization goes through authorized domain queries.
   * Held effects wait for reconciliation, not delivery, so they are excluded unless asked for.
   */
  async function pendingEffects(
    context: ExecutionContext,
    filter: {
      readonly target?: string;
      readonly limit?: number;
      readonly includeHeld?: boolean;
    } = {},
  ): Promise<readonly Effect[]> {
    trusted(context);
    const limit = filter.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new ApplicationError('INVALID_INPUT', 'Invalid effect limit');
    return options.storage.read(context.workspaceId, async (snapshot) =>
      Object.values(snapshot.effects)
        .filter(
          (effect) =>
            effect.status === 'pending' &&
            (filter.includeHeld || effect.heldAt === undefined) &&
            (filter.target === undefined || effect.target === filter.target),
        )
        .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, limit),
    );
  }
  /**
   * Host-only record of a transient delivery failure. It changes framework metadata, not feature
   * state, so the resource revision is unchanged (editors see no false conflict). A journal entry
   * at the current revision still lets authorized subscribers show retry progress.
   *
   * With `hold`, the dispatcher could not tell whether the target applied the effect. The effect
   * stays pending but leaves delivery until a domain command settles or releases it, and the
   * journal records `effect.held` so screens can ask a person to reconcile.
   */
  async function recordAttempt(
    context: ExecutionContext,
    id: string,
    failure: string,
    attempt: { readonly hold?: boolean } = {},
  ): Promise<Effect> {
    trusted(context);
    const effect = await recordAttemptInStorage(context, id, failure, attempt);
    await auditAfter([
      {
        kind: attempt.hold ? 'effect.held' : 'effect.attempted',
        outcome: 'failed',
        operation: effect.operation,
        resources: [effect.resource],
        actor: actorOf(context),
        data: {
          effectId: effect.id,
          target: effect.target,
          attempts: effect.attempts,
          failure: effect.lastFailure ?? 'Delivery failed',
        },
      },
    ]);
    return effect;
  }
  function recordAttemptInStorage(
    context: ExecutionContext,
    id: string,
    failure: string,
    attempt: { readonly hold?: boolean },
  ): Promise<Effect> {
    return options.storage.transact(context.workspaceId, async (snapshot) => {
      const effect = ownEffect(snapshot, id);
      if (!effect) throw new ApplicationError('NOT_FOUND', 'Effect unavailable');
      if (effect.status !== 'pending')
        throw new ApplicationError('CONFLICT', 'Effect already settled');
      const next: Effect = {
        ...effect,
        attempts: effect.attempts + 1,
        lastAttemptAt: now(),
        lastFailure: (failure || 'Delivery failed').slice(0, 500),
        ...(attempt.hold
          ? { heldAt: now(), holdReason: (failure || 'Outcome unknown').slice(0, 500) }
          : {}),
      };
      putEffect(snapshot, next);
      snapshot.journal.push({
        cursor: ++snapshot.cursor,
        resource: effect.resource,
        revision: revisionOf(snapshot, effect.resource),
        type: attempt.hold ? 'effect.held' : 'effect.attempted',
        operation: effect.operation,
      });
      return next;
    });
  }
  /**
   * Host-only, at startup and before serving: resolve `command.accepted` events that have no
   * outcome because the process stopped between the audited commit and `command.committed`.
   * The journal entries between `fromCursor` and `cursor` (or the idempotency receipt) decide
   * whether the command committed. It must run before new commands could reuse those cursors.
   * Appends with the log required: an unrecorded resolution would stay invisible.
   */
  async function recoverAudit(accepted: readonly AuditEvent[]): Promise<readonly AuditRecord[]> {
    const records: AuditRecord[] = [];
    for (const event of accepted) {
      const workspaceId = event.actor?.workspaceId;
      if (event.kind !== 'command.accepted' || !workspaceId || !event.operation) continue;
      const data = (event.data ?? {}) as { fromCursor?: unknown; idempotencyKey?: unknown };
      const committed = await options.storage.read(workspaceId, async (snapshot) => {
        const from = typeof data.fromCursor === 'number' ? data.fromCursor : undefined;
        const to = event.cursor;
        if (from !== undefined && to !== undefined && to > from)
          return snapshot.journal.some(
            (entry) =>
              entry.cursor > from && entry.cursor <= to && entry.operation === event.operation,
          );
        if (typeof data.idempotencyKey === 'string') {
          const key = canonicalJson([event.actor!.principalId, data.idempotencyKey]);
          const stored = Object.hasOwn(snapshot.receipts, key) ? snapshot.receipts[key] : undefined;
          return stored?.receipt.operation === event.operation && stored?.receipt.cursor === to;
        }
        // A command without changes or key leaves nothing to compare against.
        return undefined;
      });
      records.push({
        kind: committed ? 'command.recovered' : 'command.aborted',
        outcome: committed ? 'recovered' : 'aborted',
        operation: event.operation,
        ...(event.actor ? { actor: event.actor } : {}),
        ...(event.correlationId ? { correlationId: event.correlationId } : {}),
        causationId: event.hash,
        ...(event.cursor === undefined ? {} : { cursor: event.cursor }),
        ...(committed
          ? {}
          : { reason: committed === undefined ? 'UNVERIFIABLE' : 'NOT_COMMITTED' }),
      });
    }
    await audit('required', records);
    return records;
  }
  function discover(context: ExecutionContext) {
    trusted(context);
    return {
      ...catalog,
      operations: catalog.operations.map((operation) => ({
        ...operation,
        availability:
          context.grant &&
          (!context.grant.operations.includes(operation.id) ||
            (context.grant.expiresAt !== undefined && context.grant.expiresAt <= now()))
            ? ('denied' as const)
            : ('conditional' as const),
      })),
    };
  }
  return {
    catalog,
    invoke,
    query,
    invokeRaw,
    queryRaw,
    events,
    deliverEvents,
    discover,
    pendingEffects,
    recordAttempt,
    recoverAudit,
  };
}

import {
  ApplicationError,
  buildCatalog,
  canonicalJson,
  assertJson,
  type AnyCapability,
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

export function createWorkspaceSnapshot<State>(state: State): WorkspaceSnapshot<State> {
  return {
    state: structuredClone(state),
    cursor: 0,
    authorizationRevision: 0,
    resourceRevisions: {},
    receipts: {},
    journal: [],
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
}

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
  });

  async function invokeRaw(
    request: Invocation,
    context: ExecutionContext,
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
        return { ...stored.receipt, result, authorizationRevision: snapshot.authorizationRevision };
      }
      await authorize(capability, input, context, snapshot, 'invoke');
      for (const [resource, revision] of Object.entries(expected))
        if (revisionOf(snapshot, resource) !== revision)
          throw new ApplicationError('CONFLICT', 'Resource revision changed', { resource });
      const previousState = structuredClone(snapshot.state);
      const previousAuthorizationRevision = snapshot.authorizationRevision;
      const changes = new Map<string, string>();
      const output = await handler.handle(input, makeContext(snapshot, context, changes, false));
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
      return receipt;
    });
  }
  async function queryRaw(request: Invocation, context: ExecutionContext): Promise<QueryResult> {
    const { capability, input, handler } = resolve(request, 'query');
    active(context, capability.id);
    return options.storage.read(context.workspaceId, async (readonlySnapshot) => {
      const snapshot = structuredClone(readonlySnapshot);
      await authorize(capability, input, context, snapshot, 'invoke');
      const before = structuredClone(snapshot.state);
      const output = await handler.handle(input, makeContext(snapshot, context, new Map(), true));
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
  return { catalog, invoke, query, invokeRaw, queryRaw, events, deliverEvents, discover };
}

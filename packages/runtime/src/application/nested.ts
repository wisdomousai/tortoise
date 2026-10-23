import { ApplicationError, type AnyCapability } from '@agent-native/contracts';
import type { Invocation } from '../types.js';
import { sameState } from '../state-equality.js';
import { prepareCommand } from './command-request.js';
import { runFrame } from './frame.js';
import { createHandlerContext, type HandlerScope } from './handler-context.js';
import { authorize, project, resolveOperation, type Kernel } from './kernel.js';

/** Deepest nesting below the top-level frame, and most nested calls in one command. */
export const MAX_DEPTH = 4;
export const MAX_CALLS = 64;

/** One nested call, in the order the handlers made them. */
export interface CallRecord {
  readonly capability: AnyCapability;
  readonly input: unknown;
  readonly kind: 'command' | 'query';
  readonly depth: number;
  /** The enclosing operations, outermost first. */
  readonly via: readonly string[];
}

/** Who declared a changed resource: the innermost frame that declared it gets the journal entry. */
export interface Attribution {
  readonly type: string;
  readonly operation: string;
  readonly depth: number;
  /** The index of its call in `CallTree.calls`, or -1 for the top-level frame. */
  readonly call: number;
}

/** Everything the frames of one command share. */
export interface CallTree {
  readonly correlationId: string;
  readonly calls: CallRecord[];
  readonly attribution: Map<string, Attribution>;
  /** The first nested failure; it fails the transaction even when a handler caught it. */
  poisoned?: { readonly error: unknown };
}

/** One frame's place in its command's call tree. */
export interface FrameScope {
  readonly tree: CallTree;
  readonly depth: number;
  readonly call: number;
  /** The operations from the top-level frame down to this one. */
  readonly stack: readonly string[];
  /** A nested call of this frame is running; a second one at the same time is refused. */
  busy: boolean;
  /** Why the frame can make no more calls, once its handler returned. */
  closed?: string;
}

export function topFrame(operation: string, correlationId: string, closed?: string): FrameScope {
  return {
    tree: { correlationId, calls: [], attribution: new Map() },
    depth: 0,
    call: -1,
    stack: [operation],
    busy: false,
    ...(closed === undefined ? {} : { closed }),
  };
}

export const RETURNED = 'A nested call must finish before its handler returns';

/** Record a declared change for the journal: the deepest frame that declared it keeps it. */
export function attribute(frame: FrameScope, resource: string, type: string, operation: string) {
  const held = frame.tree.attribution.get(resource);
  if (held === undefined || held.depth <= frame.depth)
    frame.tree.attribution.set(resource, { type, operation, depth: frame.depth, call: frame.call });
}

/** After a frame's handler returned: refuse a call still running and a poisoned transaction. */
export function closeFrame(frame: FrameScope) {
  frame.closed = RETURNED;
  if (frame.busy) throw new ApplicationError('INTERNAL', RETURNED);
  if (frame.tree.poisoned) throw frame.tree.poisoned.error;
}

/** The enclosing operations of a frame, or undefined for a top-level frame. */
export const viaOf = (frame: FrameScope) =>
  frame.depth === 0 ? undefined : frame.stack.slice(0, -1);

/** Refuse a call the limits or the caller's declaration do not allow, before anything runs. */
function enter<State, Services>(
  kernel: Kernel<State, Services>,
  scope: HandlerScope<State>,
  operation: string,
  capability: AnyCapability,
  input: unknown,
): FrameScope {
  const { frame } = scope;
  const declared = kernel.capabilities.get(scope.operation)?.invokes;
  if (declared !== 'any' && !declared?.includes(operation))
    throw new ApplicationError('INTERNAL', `${scope.operation} does not declare ${operation}`);
  if (frame.stack.includes(operation))
    throw new ApplicationError('INTERNAL', 'A nested call cannot reach a running operation');
  if (frame.depth >= MAX_DEPTH)
    throw new ApplicationError('INTERNAL', `Nested calls go at most ${MAX_DEPTH} levels deep`);
  const { tree } = frame;
  if (tree.calls.length >= MAX_CALLS)
    throw new ApplicationError('INTERNAL', `A command makes at most ${MAX_CALLS} nested calls`);
  const { kind } = capability;
  tree.calls.push({ capability, input, kind, depth: frame.depth + 1, via: frame.stack });
  return {
    tree,
    depth: frame.depth + 1,
    call: tree.calls.length - 1,
    stack: [...frame.stack, operation],
    busy: false,
  };
}

/** Mark the frame busy around a call; a failure poisons the transaction. */
async function guarded<T>(scope: HandlerScope<unknown>, run: () => Promise<T>): Promise<T> {
  const { frame } = scope;
  if (frame.closed !== undefined) throw new ApplicationError('INTERNAL', frame.closed);
  if (frame.busy) throw new ApplicationError('INTERNAL', 'Nested calls run one at a time');
  frame.busy = true;
  try {
    return await run();
  } catch (error) {
    scope.frame.tree.poisoned ??= { error };
    throw error;
  } finally {
    scope.frame.busy = false;
  }
}

/**
 * A nested command: a frame of its own on the same draft and context. Its changes and effects
 * count toward the caller's declared-change checks, and its journal entries are attributed to it.
 */
async function invokeNested<State, Services>(
  kernel: Kernel<State, Services>,
  scope: HandlerScope<State>,
  request: Invocation,
) {
  if (scope.query) throw new ApplicationError('INTERNAL', 'Queries cannot invoke commands');
  return guarded(scope, async () => {
    const command = prepareCommand(kernel, request, scope.context, scope.frame.tree.correlationId);
    const frame = enter(kernel, scope, command.capability.id, command.capability, command.input);
    const { run, result } = await runFrame(kernel, command, scope.snapshot, frame);
    for (const [resource, type] of run.changes) scope.changes.set(resource, type);
    scope.touched.push(...run.touched);
    const effects = run.touched
      .filter((effect) => effect.status === 'pending')
      .map((effect) => effect.id);
    return { result, effects };
  });
}

/**
 * A nested query on the draft, so it reads the writes made so far. Ordering matches a direct
 * query: grant, authorization, handler, projection, authorization again. It may not change
 * state, and a remote query is refused because it would wait on a source inside the transaction.
 */
async function queryNested<State, Services>(
  kernel: Kernel<State, Services>,
  scope: HandlerScope<State>,
  request: Invocation,
) {
  return guarded(scope, async () => {
    const { capability, input, handler } = resolveOperation(kernel, request, 'query');
    if (capability.remote)
      throw new ApplicationError('INTERNAL', 'A nested call cannot read a remote query');
    const { context, snapshot } = scope;
    const frame = enter(kernel, scope, capability.id, capability, input);
    const via = viaOf(frame);
    kernel.guard.active(context, capability.id);
    await authorize(kernel, capability, input, context, snapshot, 'invoke', undefined, via);
    const before = structuredClone(snapshot.state);
    const child: HandlerScope<State> = {
      snapshot,
      context,
      operation: capability.id,
      query: true,
      changes: new Map(),
      touched: [],
      blobs: [],
      frame,
    };
    const output = await handler.handle(input, createHandlerContext(kernel, child));
    closeFrame(frame);
    if (!sameState(snapshot.state, before))
      throw new ApplicationError('INTERNAL', 'Query mutated feature state');
    const result = await project(kernel, capability, input, context, snapshot, output);
    await authorize(kernel, capability, input, context, snapshot, 'invoke', undefined, via);
    kernel.guard.active(context, capability.id);
    return result;
  });
}

/** The handler context's nested call methods. */
export function nestedMethods<State, Services>(
  kernel: Kernel<State, Services>,
  scope: HandlerScope<State>,
) {
  const request = (
    operation: string,
    input: unknown,
    expectedRevisions?: Readonly<Record<string, number>>,
  ): Invocation => ({
    operation,
    input,
    ...(expectedRevisions ? { expectedRevisions: { ...expectedRevisions } } : {}),
  });
  return {
    invokeRaw: (
      operation: string,
      input: unknown,
      expectedRevisions?: Readonly<Record<string, number>>,
    ) => invokeNested(kernel, scope, request(operation, input, expectedRevisions)),
    queryRaw: (operation: string, input: unknown) =>
      queryNested(kernel, scope, request(operation, input)),
    invoke: async (
      capability: AnyCapability,
      input: unknown,
      expectedRevisions?: Readonly<Record<string, number>>,
    ) =>
      (await invokeNested(kernel, scope, request(capability.id, input, expectedRevisions)))
        .result as never,
    query: async (capability: AnyCapability, input: unknown) =>
      (await queryNested(kernel, scope, request(capability.id, input))) as never,
  };
}

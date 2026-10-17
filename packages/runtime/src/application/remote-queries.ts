import {
  ApplicationError,
  type AnyCapability,
  type JsonValue,
  type RemoteReadDeclaration,
  type RemoteSourceStatus,
} from '@agent-native/contracts';
import type {
  ExecutionContext,
  HandlerContribution,
  QueryResult,
  WorkspaceSnapshot,
} from '../types.js';
import { sameState } from '../state-equality.js';
import { createHandlerContext } from './handler-context.js';
import { authorize, project, type Kernel } from './kernel.js';

/** The source's items, next-page cursor and status; an unavailable source has neither. */
interface Answer {
  readonly items: readonly unknown[];
  readonly next?: string;
  readonly source: RemoteSourceStatus;
}
const MAX_CURSOR = 512;
const validCursor = (next: unknown) =>
  next === undefined || (typeof next === 'string' && next.length > 0 && next.length <= MAX_CURSOR);

/** Run `fn` with a query-scoped handler context and fail if it changed feature state. */
function pure<State, Services, T>(
  kernel: Kernel<State, Services>,
  snapshot: WorkspaceSnapshot<State>,
  context: ExecutionContext,
  operation: string,
  fn: (handlerContext: ReturnType<typeof createHandlerContext<State, Services>>) => T,
): T {
  const before = structuredClone(snapshot.state);
  const handlerContext = createHandlerContext(kernel, {
    snapshot,
    context,
    operation,
    query: true,
    changes: new Map(),
    touched: [],
    blobs: [],
  });
  const result = fn(handlerContext);
  if (!sameState(snapshot.state, before))
    throw new ApplicationError('INTERNAL', 'Query mutated feature state');
  return result;
}

const boundedMessage = (message: string) => message.slice(0, 200);

/**
 * Ask the target's source, outside any transaction. A source that is missing, slow or failing
 * yields `unavailable` with a caller-safe message; provider error text is never passed on unless
 * the source marked it safe with `UNAVAILABLE`. Cancellation and other application errors
 * (notably `FORBIDDEN` for a caller without a credential) propagate.
 */
async function callSource<State, Services>(
  kernel: Kernel<State, Services>,
  capability: AnyCapability,
  remote: RemoteReadDeclaration,
  query: JsonValue,
  context: ExecutionContext,
): Promise<Answer> {
  const unavailable = (message: string): Answer => ({
    items: [],
    source: { target: remote.target, status: 'unavailable', fetchedAt: kernel.now(), message },
  });
  const source = kernel.options.sources?.[remote.target];
  if (!source) return unavailable('Source is not connected');
  const deadline = AbortSignal.timeout(kernel.options.remoteDeadlineMs ?? 10_000);
  const signal = context.signal ? AbortSignal.any([context.signal, deadline]) : deadline;
  try {
    const answer = await source.search(
      { operation: capability.id, query },
      { context, identity: remote.identity, signal },
    );
    if (answer.identity === 'service' && remote.identity === 'caller')
      throw new ApplicationError('FORBIDDEN', 'Source acted without the caller credential');
    if (!Array.isArray(answer.items) || !validCursor(answer.next))
      return unavailable('Source answer was malformed');
    return {
      items: answer.items,
      ...(answer.next ? { next: answer.next } : {}),
      source: {
        target: remote.target,
        status: 'ok',
        fetchedAt: kernel.now(),
        identity: answer.identity,
      },
    };
  } catch (error) {
    if (context.signal?.aborted) throw new ApplicationError('CANCELLED', 'Execution cancelled');
    // Whatever the source threw when its signal fired, the cause is the deadline.
    if (deadline.aborted) return unavailable('Source did not answer in time');
    if (error instanceof ApplicationError && error.code !== 'UNAVAILABLE') throw error;
    if (error instanceof ApplicationError) return unavailable(boundedMessage(error.message));
    return unavailable('Source unavailable');
  }
}

/**
 * Execute a remote query. Order matters:
 *
 * 1. In a read snapshot: authorize, then build the source query. No I/O, no mutation.
 * 2. Outside any transaction: call the source with the caller's context.
 * 3. In a fresh snapshot: authorize again, so a revocation or expiry while the source answered
 *    drops the result; map the items; project and validate the output; authorize once more,
 *    exactly like a local query.
 *
 * Paging belongs to the source: the handler puts the caller's `cursor` into the request, and the
 * source's `next` is returned untouched. A page can shrink in step 3, so only a missing `next`
 * ends the list. Nothing is stored. The snapshot cursor is the local one at step 3, so a screen can still follow local
 * changes, but the remote items are point-in-time and carry their fetch time.
 */
export async function readRemoteQuery<State, Services>(
  kernel: Kernel<State, Services>,
  capability: AnyCapability,
  input: unknown,
  handler: HandlerContribution<State, Services>,
  context: ExecutionContext,
): Promise<QueryResult & { readonly source: RemoteSourceStatus }> {
  const remote = capability.remote!;
  const read = handler.remote!;
  const query = await kernel.options.storage.read(context.workspaceId, async (readonly) => {
    const snapshot = structuredClone(readonly);
    await authorize(kernel, capability, input, context, snapshot, 'invoke');
    return pure(kernel, snapshot, context, capability.id, (ctx) => read.request(input, ctx));
  });
  const answer = await callSource(kernel, capability, remote, query, context);
  return kernel.options.storage.read(context.workspaceId, async (readonly) => {
    const snapshot = structuredClone(readonly);
    await authorize(kernel, capability, input, context, snapshot, 'invoke');
    const items = pure(kernel, snapshot, context, capability.id, (ctx) =>
      answer.items.map((found) => read.item(found, ctx)).filter((item) => item !== undefined),
    );
    const output = {
      items,
      ...(answer.next ? { next: answer.next } : {}),
      source: answer.source,
    };
    const data = await project(kernel, capability, input, context, snapshot, output);
    await authorize(kernel, capability, input, context, snapshot, 'invoke');
    kernel.guard.active(context, capability.id);
    return {
      data,
      cursor: snapshot.cursor,
      authorizationRevision: snapshot.authorizationRevision,
      source: answer.source,
    };
  });
}

import { ApplicationError, type JsonObject } from '@agent-native/contracts';
import type { ExecutionContext, Invocation, QueryResult } from '../types.js';
import { sameState } from '../state-equality.js';
import { actorOf, describeInput, failureRecord } from './audit.js';
import { createHandlerContext } from './handler-context.js';
import { authorize, project, resolveOperation, type Kernel } from './kernel.js';
import { closeFrame, topFrame } from './nested.js';
import { readRemoteQuery } from './remote-queries.js';

/** Audit details a query adds: the input digest, and for a remote query its source status. */
interface QueryAudit {
  inputDigest?: string;
  data?: JsonObject;
}

async function readQuery<State, Services>(
  kernel: Kernel<State, Services>,
  request: Invocation,
  context: ExecutionContext,
  audit: QueryAudit,
  correlationId: string,
): Promise<QueryResult> {
  const { capability, input, handler } = resolveOperation(kernel, request, 'query');
  kernel.guard.active(context, capability.id);
  if (kernel.audit.enabled) audit.inputDigest = describeInput(capability, input).inputDigest;
  if (capability.remote) {
    const { source, ...result } = await readRemoteQuery(
      kernel,
      capability,
      input,
      handler,
      context,
    );
    // Target, status and credential kind only: never the query, items or provider text.
    audit.data = {
      target: source.target,
      status: source.status,
      ...(source.identity ? { identity: source.identity } : {}),
      items: (result.data as { items: unknown[] }).items.length,
      more: (result.data as { next?: string }).next !== undefined,
    };
    return result;
  }
  return kernel.options.storage.read(context.workspaceId, async (readonlySnapshot) => {
    const snapshot = structuredClone(readonlySnapshot);
    await authorize(kernel, capability, input, context, snapshot, 'invoke');
    const before = structuredClone(snapshot.state);
    const frame = topFrame(capability.id, correlationId);
    const output = await handler.handle(
      input,
      createHandlerContext(kernel, {
        snapshot,
        context,
        operation: capability.id,
        query: true,
        changes: new Map(),
        touched: [],
        blobs: [],
        frame,
      }),
    );
    closeFrame(frame);
    if (!sameState(snapshot.state, before))
      throw new ApplicationError('INTERNAL', 'Query mutated feature state');
    const result = await project(kernel, capability, input, context, snapshot, output);
    await authorize(kernel, capability, input, context, snapshot, 'invoke');
    kernel.guard.active(context, capability.id);
    return {
      data: result,
      cursor: snapshot.cursor,
      authorizationRevision: snapshot.authorizationRevision,
    };
  });
}

/**
 * Queries are audited after the read: `query.executed` must be durable before data is returned
 * when the log is required for queries. Refusals are recorded as `query.denied`.
 */
export function createQueries<State, Services>(kernel: Kernel<State, Services>) {
  return async function queryRaw(
    request: Invocation,
    context: ExecutionContext,
  ): Promise<QueryResult> {
    const correlationId = crypto.randomUUID();
    const operation = typeof request?.operation === 'string' ? request.operation : '';
    let result: QueryResult;
    const audit: QueryAudit = {};
    try {
      result = await readQuery(kernel, request, context, audit, correlationId);
    } catch (error) {
      if (kernel.audit.enabled)
        await kernel.audit.after([
          failureRecord('query', operation, context, correlationId, error),
        ]);
      throw error;
    }
    await kernel.audit.append(kernel.audit.queryMode(), [
      {
        kind: 'query.executed',
        outcome: 'allowed',
        operation,
        actor: actorOf(context),
        correlationId,
        cursor: result.cursor,
        ...(audit.inputDigest ? { inputDigest: audit.inputDigest } : {}),
        ...(audit.data ? { data: audit.data } : {}),
      },
    ]);
    return result;
  };
}

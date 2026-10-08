import { ApplicationError } from '@agent-native/contracts';
import type { ExecutionContext, Invocation, QueryResult } from '../types.js';
import { sameState } from '../state-equality.js';
import { actorOf, describeInput, failureRecord } from './audit.js';
import { createHandlerContext } from './handler-context.js';
import { authorize, project, resolveOperation, type Kernel } from './kernel.js';

async function readQuery<State, Services>(
  kernel: Kernel<State, Services>,
  request: Invocation,
  context: ExecutionContext,
  describe: (inputDigest: string) => void,
): Promise<QueryResult> {
  const { capability, input, handler } = resolveOperation(kernel, request, 'query');
  kernel.guard.active(context, capability.id);
  if (kernel.audit.enabled) describe(describeInput(capability, input).inputDigest);
  return kernel.options.storage.read(context.workspaceId, async (readonlySnapshot) => {
    const snapshot = structuredClone(readonlySnapshot);
    await authorize(kernel, capability, input, context, snapshot, 'invoke');
    const before = structuredClone(snapshot.state);
    const output = await handler.handle(
      input,
      createHandlerContext(kernel, {
        snapshot,
        context,
        operation: capability.id,
        query: true,
        changes: new Map(),
        touched: [],
      }),
    );
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
    let inputDigest: string | undefined;
    try {
      result = await readQuery(kernel, request, context, (digest) => (inputDigest = digest));
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
        ...(inputDigest ? { inputDigest } : {}),
      },
    ]);
    return result;
  };
}

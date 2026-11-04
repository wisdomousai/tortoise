import { ApplicationError, canonicalJson, type AnyCapability } from '@tortoise/contracts';
import type { ExecutionContext, HandlerContribution, Invocation } from '../types.js';
import { actorOf, receiptScope } from './audit.js';
import { resolveOperation, type Kernel } from './kernel.js';

/** One command after validation; everything the transaction needs besides the snapshot. */
export interface Command<State, Services> {
  readonly capability: AnyCapability;
  readonly input: unknown;
  readonly handler: HandlerContribution<State, Services>;
  readonly request: Invocation;
  readonly context: ExecutionContext;
  readonly correlationId: string;
  readonly expected: Readonly<Record<string, number>>;
  readonly fingerprint: string;
  /** Idempotency receipt key, scoped to the principal. */
  readonly key: string | undefined;
}

function expectedRevisions(request: Invocation): Readonly<Record<string, number>> {
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
  return expected;
}

/** Everything that makes a retry "the same request": a reused key with another fingerprint conflicts. */
function fingerprintOf(
  contractVersion: string,
  operation: string,
  input: unknown,
  expected: Readonly<Record<string, number>>,
  context: ExecutionContext,
): string {
  const grant = context.grant
    ? {
        operations: [...context.grant.operations].sort(),
        resources: context.grant.resources ? [...context.grant.resources].sort() : null,
        expiresAt: context.grant.expiresAt ?? null,
        principalId: context.grant.principalId ?? null,
        workspaceId: context.grant.workspaceId ?? null,
        runId: context.grant.runId ?? null,
        ...(context.grant.agent === undefined ? {} : { agent: context.grant.agent }),
      }
    : null;
  return canonicalJson({
    contractVersion,
    operation,
    input,
    expectedRevisions: expected,
    runId: context.runId ?? null,
    grant,
    // A peer's receipts are keyed by the peer: the person it acted for makes it another request.
    ...(context.peer?.subject === undefined ? {} : { principalId: context.principalId }),
  });
}

export function prepareCommand<State, Services>(
  kernel: Kernel<State, Services>,
  request: Invocation,
  context: ExecutionContext,
  correlationId: string,
): Command<State, Services> {
  const { capability, input, handler } = resolveOperation(kernel, request, 'command');
  kernel.guard.active(context, capability.id);
  const expected = expectedRevisions(request);
  const contractVersion = kernel.options.contractVersion ?? '1.0.0';
  return {
    capability,
    input,
    handler,
    request,
    context,
    correlationId,
    expected,
    fingerprint: fingerprintOf(contractVersion, capability.id, input, expected, context),
    key:
      request.idempotencyKey === undefined
        ? undefined
        : canonicalJson([receiptScope(actorOf(context)), request.idempotencyKey]),
  };
}

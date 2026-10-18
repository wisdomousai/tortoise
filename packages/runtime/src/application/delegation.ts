import { ApplicationError } from '@agent-native/contracts';
import type { DelegationGrant, ExecutionContext } from '../types.js';

/** A grant without resource scope covers every resource. */
export const grantCoversResource = (grant: DelegationGrant | undefined, resource: string) =>
  !grant?.resources || grant.resources.includes(resource);

/**
 * Whether an unexpired grant permits an operation (and, when given, a resource). No grant means
 * the principal acts with its own grants, which policy decides.
 */
export function grantPermits(
  grant: DelegationGrant | undefined,
  now: number,
  operation: string,
  resource?: string,
): boolean {
  if (!grant) return true;
  return (
    grant.operations.includes(operation) &&
    (grant.expiresAt === undefined || grant.expiresAt > now) &&
    (resource === undefined || grantCoversResource(grant, resource))
  );
}

function boundElsewhere(context: ExecutionContext): boolean {
  const grant = context.grant;
  return (
    !!grant &&
    ((grant.principalId !== undefined && grant.principalId !== context.principalId) ||
      (grant.workspaceId !== undefined && grant.workspaceId !== context.workspaceId) ||
      (grant.runId !== undefined && grant.runId !== context.runId))
  );
}

/** Checks of the trusted execution context, repeated after every awaited step. */
export function createContextGuard(now: () => number) {
  /** A context the host vouched for: identified, not cancelled, its grant bound here and live. */
  function trusted(context: ExecutionContext): void {
    if (!context.workspaceId || !context.principalId)
      throw new ApplicationError('FORBIDDEN', 'Trusted workspace and principal required');
    if (context.signal?.aborted) throw new ApplicationError('CANCELLED', 'Execution cancelled');
    if (boundElsewhere(context))
      throw new ApplicationError('FORBIDDEN', 'Delegation is bound to another execution context');
    if (
      context.grant?.expiresAt !== undefined &&
      (!Number.isFinite(context.grant.expiresAt) || context.grant.expiresAt <= now())
    )
      throw new ApplicationError('FORBIDDEN', 'Delegation expired');
  }
  /** Trusted, and its grant (if any) still names the operation. */
  function active(context: ExecutionContext, operation: string): void {
    trusted(context);
    if (context.grant && !context.grant.operations.includes(operation))
      throw new ApplicationError('FORBIDDEN', 'Delegation does not permit operation');
  }
  return { trusted, active };
}
export type ContextGuard = ReturnType<typeof createContextGuard>;

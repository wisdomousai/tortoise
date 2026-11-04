import { ApplicationError } from '@tortoise/contracts';
import type { ResolvedPolicy } from './policy';
import type { ExecutionContext } from '@tortoise/runtime';

/**
 * Enforce the deployment policy's identity floor before a session or embedded call is created.
 * `context` is the delegated context from launcher configuration, or undefined for the OS
 * account's local owner. `serving` is true for the serving host's own startup check.
 *
 * - `local-owner` admits both.
 * - `grant-file` admits only a delegated context.
 * - `external` admits a delegated context, and the local owner only as a serving host, which then
 *   issues it no session: people sign in through the workforce identity provider instead. An
 *   embedded call as the local owner would bypass that sign-in, so it is refused.
 *
 * With `grants.maxTtlSeconds`, a delegated grant must carry an expiry no further away than that.
 * Throws FORBIDDEN.
 */
export function assertIdentity(
  policy: ResolvedPolicy,
  context: ExecutionContext | undefined,
  serving: boolean,
  now = Date.now(),
): void {
  const floor = policy.policy.identity;
  if (floor === 'external' && !context?.grant && !serving)
    throw new ApplicationError(
      'FORBIDDEN',
      `${policy.profile} signs people in through the workforce identity provider; embedded calls need a delegated grant`,
    );
  if (floor === 'grant-file' && !context?.grant)
    throw new ApplicationError(
      'FORBIDDEN',
      `${policy.profile} admits only delegated grants from launcher configuration, not the local owner`,
    );
  const maxTtlSeconds = policy.policy.grants.maxTtlSeconds;
  const expiresAt = context?.grant?.expiresAt;
  if (context?.grant && maxTtlSeconds !== undefined)
    if (expiresAt === undefined || expiresAt - now > maxTtlSeconds * 1000)
      throw new ApplicationError(
        'FORBIDDEN',
        `Delegated grants must expire within ${maxTtlSeconds} seconds under this deployment policy`,
      );
}

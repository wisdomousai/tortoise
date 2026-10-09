import { ApplicationError } from '@agent-native/contracts';
import type { ResolvedPolicy } from '@agent-native/egress';
import type { ExecutionContext } from '@agent-native/runtime';

/**
 * Enforce the site policy's identity floor before a session or embedded call is created.
 * `context` is the delegated context from launcher configuration, or undefined for the OS
 * account's local owner.
 *
 * - `local-owner` admits both.
 * - `grant-file` admits only a delegated context.
 * - `external` needs a workforce identity adapter this build does not compose, so it refuses
 *   rather than fall back to the local owner.
 *
 * With `grants.maxTtlSeconds`, a delegated grant must carry an expiry no further away than that.
 * Throws FORBIDDEN, or UNAVAILABLE for the missing adapter.
 */
export function assertIdentity(
  policy: ResolvedPolicy,
  context: ExecutionContext | undefined,
  now = Date.now(),
): void {
  const floor = policy.policy.identity;
  if (floor === 'external')
    throw new ApplicationError(
      'UNAVAILABLE',
      `${policy.profile} requires an external identity adapter; none is composed in this build`,
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
        `Delegated grants must expire within ${maxTtlSeconds} seconds under this site policy`,
      );
}

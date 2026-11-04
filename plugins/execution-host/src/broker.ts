import { randomBytes } from 'node:crypto';
import { ApplicationError } from '@tortoise/contracts';
import type { ExecutionContext } from '@tortoise/runtime';

/**
 * Credentials for sandboxes. Each run gets one random bearer token that stands for the run's
 * delegated context and nothing else; the host asks `authenticate` on every request, so a
 * revoked or expired token stops working at the next call. The token is the only credential a
 * sandbox ever holds: no provider key, no owner session, no grant file it could reuse elsewhere.
 */
export interface Broker {
  /** Issue a token for `context`, which must carry a grant, ending at `expiresAt` at the latest. */
  issue(context: ExecutionContext, expiresAt: number): { token: string; context: ExecutionContext };
  authenticate(token: string): ExecutionContext | undefined;
  revoke(token: string): void;
  /** Tokens still live, for tests and `describe`. */
  size(): number;
}

export function createBroker(now: () => number = Date.now): Broker {
  const live = new Map<string, { context: ExecutionContext; expiresAt: number }>();
  return {
    issue(context, expiresAt) {
      const grant = context.grant;
      if (!grant)
        throw new ApplicationError('FORBIDDEN', 'A sandbox acts only under a delegation grant');
      const end = Math.min(expiresAt, grant.expiresAt ?? expiresAt);
      if (!(end > now())) throw new ApplicationError('FORBIDDEN', 'Delegation expired');
      // Bound to the caller's principal, workspace and run, and ending with the run.
      const bound: ExecutionContext = {
        workspaceId: context.workspaceId,
        principalId: context.principalId,
        ...(context.runId ? { runId: context.runId } : {}),
        grant: {
          ...grant,
          expiresAt: end,
          principalId: context.principalId,
          workspaceId: context.workspaceId,
          ...(context.runId ? { runId: context.runId } : {}),
        },
      };
      const token = randomBytes(32).toString('base64url');
      live.set(token, { context: bound, expiresAt: end });
      return { token, context: bound };
    },
    authenticate(token) {
      const entry = live.get(token);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        live.delete(token);
        return undefined;
      }
      return entry.context;
    },
    revoke: (token) => void live.delete(token),
    size: () => live.size,
  };
}

import { canonicalJson } from '@tortoise/contracts';
import type { ExecutionContext } from '@tortoise/runtime';
import type { HostSession } from '@tortoise/adapters/http';
import type { RunSnapshot } from '@tortoise/agents/types';
import type { HostedApplication } from '../application';

/** A session sees its own runs: same principal, workspace and grant, while the grant is live. */
export function ownsRun(run: RunSnapshot, session: HostSession) {
  const grant = session.context.grant;
  return (
    run.context.principalId === session.context.principalId &&
    run.context.workspaceId === session.context.workspaceId &&
    (grant?.expiresAt === undefined || grant.expiresAt > Date.now()) &&
    canonicalJson(run.context.grant ?? null) === canonicalJson(grant ?? null)
  );
}

/** The run as the caller may see it under the current authorization revision. */
export async function visibleRun(
  application: HostedApplication,
  run: RunSnapshot,
  context: ExecutionContext,
) {
  const current = await application.events(0, context);
  if (run.context.authorizationRevision === current.authorizationRevision) return run;
  // Free-form model text cannot be reprojected like a typed domain DTO. A policy
  // generation change hides old output and target context instead of leaking it again.
  return {
    id: run.id,
    harnessId: run.harnessId,
    conversationId: run.conversationId,
    state: run.state,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    events: [],
    context: {},
    historyUnavailable: true,
  };
}

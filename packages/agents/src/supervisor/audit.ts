import type { AuditActor, AuditRecord, JsonObject } from '@agent-native/contracts';
import type { RunSnapshot } from '../types';

const outcomes = {
  succeeded: 'completed',
  failed: 'failed',
  cancelled: 'aborted',
  interrupted: 'aborted',
} as const;

/**
 * The audit record for a run being queued or ending: the harness, the end state, the failure
 * code and the duration, and the model's provider and name when the harness declares one. Never
 * the prompt, the output or the captured selection. The actor is the principal the run acts for
 * when its context names one, otherwise `actor`.
 */
export function runAuditRecord(
  snapshot: Readonly<RunSnapshot>,
  change: 'started' | 'ended',
  actor: Omit<AuditActor, 'runId'> = { principalId: 'host' },
): AuditRecord {
  const principal = snapshot.context.principalId;
  const workspace = snapshot.context.workspaceId;
  const base: AuditActor = {
    ...actor,
    ...(typeof principal === 'string' ? { principalId: principal } : {}),
    ...(typeof workspace === 'string' ? { workspaceId: workspace } : {}),
    runId: snapshot.id,
    via: 'harness',
  };
  const created = Date.parse(snapshot.createdAt);
  const updated = Date.parse(snapshot.updatedAt);
  const model: JsonObject = snapshot.model
    ? { provider: snapshot.model.provider, model: snapshot.model.model }
    : {};
  if (change === 'started')
    return {
      kind: 'run.started',
      outcome: 'info',
      ...(Number.isFinite(created) ? { at: created } : {}),
      actor: base,
      data: { harness: snapshot.harnessId, ...model },
    };
  const outcome = outcomes[snapshot.state as keyof typeof outcomes] ?? 'info';
  return {
    kind: 'run.ended',
    outcome,
    ...(Number.isFinite(updated) ? { at: updated } : {}),
    actor: base,
    ...(snapshot.failure ? { reason: snapshot.failure.code } : {}),
    data: {
      harness: snapshot.harnessId,
      state: snapshot.state,
      ...(Number.isFinite(updated - created) ? { durationMs: Math.max(0, updated - created) } : {}),
      ...model,
    },
  };
}

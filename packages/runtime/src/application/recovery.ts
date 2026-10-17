import { canonicalJson, type AuditEvent, type AuditRecord } from '@agent-native/contracts';
import type { WorkspaceSnapshot } from '../types.js';
import type { Kernel } from './kernel.js';

/**
 * Whether the journal (or the idempotency receipt) shows the accepted command committed.
 * `undefined` when a command without changes or key left nothing to compare against.
 */
function committedIn<State>(
  snapshot: WorkspaceSnapshot<State>,
  event: AuditEvent,
): boolean | undefined {
  const data = (event.data ?? {}) as { fromCursor?: unknown; idempotencyKey?: unknown };
  const from = typeof data.fromCursor === 'number' ? data.fromCursor : undefined;
  const to = event.cursor;
  // Retention removed the entries that would show it; a receipt may still answer below.
  const compacted = from !== undefined && from < (snapshot.journalFloor ?? 0);
  if (from !== undefined && to !== undefined && to > from && !compacted)
    return snapshot.journal.some(
      (entry) => entry.cursor > from && entry.cursor <= to && entry.operation === event.operation,
    );
  if (typeof data.idempotencyKey === 'string') {
    const key = canonicalJson([event.actor!.principalId, data.idempotencyKey]);
    const stored = Object.hasOwn(snapshot.receipts, key) ? snapshot.receipts[key] : undefined;
    return stored?.receipt.operation === event.operation && stored?.receipt.cursor === to;
  }
  return undefined;
}

function resolution(event: AuditEvent, committed: boolean | undefined): AuditRecord {
  return {
    kind: committed ? 'command.recovered' : 'command.aborted',
    outcome: committed ? 'recovered' : 'aborted',
    operation: event.operation!,
    ...(event.actor ? { actor: event.actor } : {}),
    ...(event.correlationId ? { correlationId: event.correlationId } : {}),
    causationId: event.hash,
    ...(event.cursor === undefined ? {} : { cursor: event.cursor }),
    ...(committed ? {} : { reason: committed === undefined ? 'UNVERIFIABLE' : 'NOT_COMMITTED' }),
  };
}

/**
 * Host-only, at startup and before serving: resolve `command.accepted` events that have no
 * outcome because the process stopped between the audited commit and `command.committed`.
 * The journal entries between `fromCursor` and `cursor` (or the idempotency receipt) decide
 * whether the command committed. It must run before new commands could reuse those cursors.
 * Appends with the log required: an unrecorded resolution would stay invisible.
 */
export function createRecovery<State, Services>(kernel: Kernel<State, Services>) {
  return async function recoverAudit(
    accepted: readonly AuditEvent[],
  ): Promise<readonly AuditRecord[]> {
    const records: AuditRecord[] = [];
    for (const event of accepted) {
      const workspaceId = event.actor?.workspaceId;
      if (event.kind !== 'command.accepted' || !workspaceId || !event.operation) continue;
      const committed = await kernel.options.storage.read(workspaceId, async (snapshot) =>
        committedIn(snapshot, event),
      );
      records.push(resolution(event, committed));
    }
    await kernel.audit.append('required', records);
    return records;
  };
}

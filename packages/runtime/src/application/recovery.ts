import { canonicalJson, type AuditEvent, type AuditRecord } from '@agent-native/contracts';
import type { WorkspaceSnapshot } from '../types.js';
import { receiptScope } from './audit.js';
import type { Kernel } from './kernel.js';

/**
 * Whether the journal (or the idempotency receipt) shows the accepted transaction committed.
 * The group holds the `command.accepted` events of one transaction: the command, the commands
 * it invoked and the one it continued with. `undefined` when a transaction without changes or
 * key left nothing to compare against.
 */
function committedIn<State>(
  snapshot: WorkspaceSnapshot<State>,
  group: readonly AuditEvent[],
): boolean | undefined {
  const dataOf = (event: AuditEvent) =>
    (event.data ?? {}) as { fromCursor?: unknown; idempotencyKey?: unknown };
  const froms = group
    .map((event) => dataOf(event).fromCursor)
    .filter((from): from is number => typeof from === 'number');
  const tos = group.map((event) => event.cursor).filter((to): to is number => to !== undefined);
  const from = froms.length ? Math.min(...froms) : undefined;
  const to = tos.length ? Math.max(...tos) : undefined;
  const operations = new Set(group.map((event) => event.operation));
  // Retention removed the entries that would show it; a receipt may still answer below.
  const compacted = from !== undefined && from < (snapshot.journalFloor ?? 0);
  if (from !== undefined && to !== undefined && to > from && !compacted)
    return snapshot.journal.some(
      (entry) => entry.cursor > from && entry.cursor <= to && operations.has(entry.operation),
    );
  const keyed = group.find((event) => typeof dataOf(event).idempotencyKey === 'string');
  if (keyed) {
    const key = canonicalJson([receiptScope(keyed.actor!), dataOf(keyed).idempotencyKey]);
    const stored = Object.hasOwn(snapshot.receipts, key) ? snapshot.receipts[key] : undefined;
    return stored?.receipt.operation === keyed.operation && stored?.receipt.cursor === keyed.cursor;
  }
  return undefined;
}

/** The accepted events of one transaction share its correlation ID. */
function byTransaction(accepted: readonly AuditEvent[]): AuditEvent[][] {
  const groups = new Map<string, AuditEvent[]>();
  const single: AuditEvent[][] = [];
  for (const event of accepted) {
    if (event.kind !== 'command.accepted' || !event.actor?.workspaceId || !event.operation)
      continue;
    const id = event.correlationId;
    if (id === undefined) single.push([event]);
    else groups.set(id, [...(groups.get(id) ?? []), event]);
  }
  return [...groups.values(), ...single];
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
 * Events are resolved per transaction, by correlation ID: the journal entries between
 * `fromCursor` and `cursor` of any of its operations (or the idempotency receipt) decide whether
 * it committed. It must run before new commands could reuse those cursors.
 * Appends with the log required: an unrecorded resolution would stay invisible.
 */
export function createRecovery<State, Services>(kernel: Kernel<State, Services>) {
  return async function recoverAudit(
    accepted: readonly AuditEvent[],
  ): Promise<readonly AuditRecord[]> {
    const records: AuditRecord[] = [];
    for (const group of byTransaction(accepted)) {
      const committed = await kernel.options.storage.read(
        group[0]!.actor!.workspaceId!,
        async (snapshot) => committedIn(snapshot, group),
      );
      records.push(...group.map((event) => resolution(event, committed)));
    }
    await kernel.audit.append('required', records);
    return records;
  };
}

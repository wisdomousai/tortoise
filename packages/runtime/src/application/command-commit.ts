import { assertJson, type JsonValue } from '@agent-native/contracts';
import type { CommandReceipt, Effect, WorkspaceSnapshot } from '../types.js';
import { actorOf, describeInput } from './audit.js';
import type { Command } from './command-request.js';
import type { Kernel } from './kernel.js';
import { byCodePoint, defineOwn, revisionOf } from './records.js';

/** Assign the next revision of each declared resource and journal it, in code-point order. */
export function journalChanges<State>(
  snapshot: WorkspaceSnapshot<State>,
  changes: ReadonlyMap<string, string>,
  operation: string,
): Record<string, number> {
  const revisions: Record<string, number> = {};
  for (const [resource, type] of [...changes].sort(([a], [b]) => byCodePoint(a, b))) {
    const revision = revisionOf(snapshot, resource) + 1;
    defineOwn(snapshot.resourceRevisions, resource, revision);
    defineOwn(revisions, resource, revision);
    snapshot.journal.push({ cursor: ++snapshot.cursor, resource, revision, type, operation });
    if (type === 'authorization.changed') snapshot.authorizationRevision++;
  }
  return revisions;
}

export function receiptOf<State>(
  snapshot: WorkspaceSnapshot<State>,
  operation: string,
  result: unknown,
  revisions: Record<string, number>,
  touched: readonly Effect[],
): CommandReceipt {
  const pending = touched.filter((effect) => effect.status === 'pending');
  return {
    operation,
    result,
    cursor: snapshot.cursor,
    authorizationRevision: snapshot.authorizationRevision,
    revisions,
    ...(pending.length ? { effects: pending.map((effect) => effect.id) } : {}),
  };
}

export function storeReceipt<State, Services>(
  snapshot: WorkspaceSnapshot<State>,
  command: Command<State, Services>,
  receipt: CommandReceipt,
  continued?: Command<State, Services>,
) {
  if (command.key === undefined) return;
  assertJson(command.input);
  if (continued) assertJson(continued.input);
  snapshot.receipts[command.key] = {
    fingerprint: command.fingerprint,
    receipt: structuredClone(receipt),
    principalId: command.context.principalId,
    input: command.input as JsonValue,
    // Replay reauthorizes and reprojects the continued command with the input it ran with.
    ...(continued
      ? {
          continuation: {
            operation: continued.capability.id,
            input: structuredClone(continued.input) as JsonValue,
          },
        }
      : {}),
  };
}

/**
 * Last step inside the transaction: nothing commits unless this append is durable (when
 * required). `fromCursor` lets recovery find this command's journal entries.
 */
export async function auditAccepted<State, Services>(
  kernel: Kernel<State, Services>,
  command: Command<State, Services>,
  snapshot: WorkspaceSnapshot<State>,
  revisions: Record<string, number>,
  changeCount: number,
) {
  const { capability, input, context, request } = command;
  const described = describeInput(capability, input);
  await kernel.audit.append(kernel.audit.commandMode(), [
    {
      kind: 'command.accepted',
      outcome: 'accepted',
      operation: capability.id,
      actor: actorOf(context),
      correlationId: command.correlationId,
      cursor: snapshot.cursor,
      resources: Object.keys(revisions).sort(),
      inputDigest: described.inputDigest,
      data: {
        ...described.data,
        fromCursor: snapshot.cursor - changeCount,
        ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
      },
    },
  ]);
}

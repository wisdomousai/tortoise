import {
  assertJson,
  type AnyCapability,
  type AuditRecord,
  type JsonObject,
  type JsonValue,
} from '@tortoise/contracts';
import type { CommandResult, Effect, WorkspaceSnapshot } from '../types.js';
import { actorOf, describeInput } from './audit.js';
import type { Command } from './command-request.js';
import type { Kernel } from './kernel.js';
import type { CallTree } from './nested.js';
import { byCodePoint, defineOwn, revisionOf } from './records.js';

/**
 * Assign the next revision of each declared resource and journal it, in code-point order: one
 * entry per resource, with the type and operation of the innermost frame that declared it.
 */
export function journalChanges<State>(
  snapshot: WorkspaceSnapshot<State>,
  changes: ReadonlyMap<string, string>,
  operation: string,
  tree?: CallTree,
): Record<string, number> {
  const revisions: Record<string, number> = {};
  for (const [resource, declared] of [...changes].sort(([a], [b]) => byCodePoint(a, b))) {
    const revision = revisionOf(snapshot, resource) + 1;
    const held = tree?.attribution.get(resource);
    const type = held?.type ?? declared;
    defineOwn(snapshot.resourceRevisions, resource, revision);
    defineOwn(revisions, resource, revision);
    snapshot.journal.push({
      cursor: ++snapshot.cursor,
      resource,
      revision,
      type,
      operation: held?.operation ?? operation,
    });
    if (type === 'authorization.changed') snapshot.authorizationRevision++;
  }
  return revisions;
}

export function commandResultOf<State>(
  snapshot: WorkspaceSnapshot<State>,
  operation: string,
  result: unknown,
  revisions: Record<string, number>,
  touched: readonly Effect[],
): CommandResult {
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

/** The nested commands of a call tree, as a stored command result records them for replay. */
function callsOf(tree: CallTree) {
  return tree.calls
    .filter((call) => call.kind === 'command')
    .map((call) => {
      assertJson(call.input);
      return {
        operation: call.capability.id,
        input: structuredClone(call.input) as JsonValue,
        via: [...call.via],
      };
    });
}

export function storeCommandResult<State, Services>(
  snapshot: WorkspaceSnapshot<State>,
  command: Command<State, Services>,
  commandResult: CommandResult,
  tree: CallTree,
  continued?: Command<State, Services>,
) {
  if (command.key === undefined) return;
  assertJson(command.input);
  if (continued) assertJson(continued.input);
  const calls = callsOf(tree);
  snapshot.commandResults[command.key] = {
    fingerprint: command.fingerprint,
    commandResult: structuredClone(commandResult),
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
    ...(calls.length ? { calls } : {}),
  };
}

/**
 * Last step inside the transaction: nothing commits unless this append is durable (when
 * required). One `command.accepted` for the command and one for each nested command it invoked,
 * with `depth` and the calling operation as `parent`, each listing the resources journaled under
 * it. All share the correlation ID and `fromCursor`, which lets recovery find the journal
 * entries of the whole transaction.
 */
export async function auditAccepted<State, Services>(
  kernel: Kernel<State, Services>,
  command: Command<State, Services>,
  snapshot: WorkspaceSnapshot<State>,
  revisions: Record<string, number>,
  fromCursor: number,
  tree: CallTree,
) {
  const { capability, input, context, request } = command;
  const resources = (call: number) =>
    Object.keys(revisions)
      .filter((resource) => (tree.attribution.get(resource)?.call ?? -1) === call)
      .sort();
  const accepted = (
    operation: AnyCapability,
    operationInput: unknown,
    call: number,
    data: JsonObject,
  ): AuditRecord => {
    const described = describeInput(operation, operationInput);
    return {
      kind: 'command.accepted',
      outcome: 'accepted',
      operation: operation.id,
      actor: actorOf(context),
      correlationId: command.correlationId,
      cursor: snapshot.cursor,
      resources: resources(call),
      inputDigest: described.inputDigest,
      data: { ...described.data, fromCursor, ...data },
    };
  };
  await kernel.audit.append(kernel.audit.commandMode(), [
    accepted(
      capability,
      input,
      -1,
      request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey },
    ),
    ...tree.calls.flatMap((call, index) =>
      call.kind === 'command'
        ? [
            accepted(call.capability, call.input, index, {
              depth: call.depth,
              parent: call.via.at(-1)!,
            }),
          ]
        : [],
    ),
  ]);
}

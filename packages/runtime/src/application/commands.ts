import { ApplicationError } from '@agent-native/contracts';
import type {
  CommandReceipt,
  Effect,
  ExecutionContext,
  Invocation,
  StoredReceipt,
  WorkspaceSnapshot,
} from '../types.js';
import { actorOf, effectRecords, failureRecord } from './audit.js';
import { auditAccepted, journalChanges, receiptOf, storeReceipt } from './command-commit.js';
import { prepareCommand, type Command } from './command-request.js';
import { checkPreconditions, runHandler } from './command-steps.js';
import { replayContinuation, runContinuation } from './continuation.js';
import { authorize, project, type Kernel } from './kernel.js';

type Report = (effects: Effect[], replay: boolean) => void;
/** A retry returns the stored receipt, reprojected for the caller's current authority. */
async function replay<State, Services>(
  kernel: Kernel<State, Services>,
  command: Command<State, Services>,
  snapshot: WorkspaceSnapshot<State>,
  stored: StoredReceipt,
): Promise<CommandReceipt> {
  const { capability, input, context } = command;
  await authorize(kernel, capability, input, context, snapshot, 'replay');
  if (stored.fingerprint !== command.fingerprint)
    throw new ApplicationError(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key was used for another request',
    );
  const result = await project(kernel, capability, input, context, snapshot, stored.receipt.result);
  const continuation = await replayContinuation(kernel, command, snapshot, stored);
  await authorize(kernel, capability, input, context, snapshot, 'replay');
  return {
    ...stored.receipt,
    result,
    ...(continuation ? { continuation } : {}),
    authorizationRevision: snapshot.authorizationRevision,
  };
}

/**
 * The transaction body of a first execution: authorize, check, run, recheck, then any command
 * the handler continued with through the same steps, then journal, receipt and audit for both.
 * The parent's journal entries come first, so its audit `fromCursor` covers both commands.
 */
async function execute<State, Services>(
  kernel: Kernel<State, Services>,
  command: Command<State, Services>,
  snapshot: WorkspaceSnapshot<State>,
  report: Report,
): Promise<CommandReceipt> {
  const { capability, input, context } = command;
  await authorize(kernel, capability, input, context, snapshot, 'invoke');
  await checkPreconditions(kernel, command, snapshot);
  const run = await runHandler(kernel, command, snapshot);
  const result = await project(kernel, capability, input, context, snapshot, run.output);
  await authorize(kernel, capability, input, context, snapshot, 'commit', run.previousState);
  kernel.guard.active(context, capability.id);
  const next = run.continuation
    ? await runContinuation(kernel, command, snapshot, run.continuation)
    : undefined;
  const revisions = journalChanges(snapshot, run.changes, capability.id);
  const continued = next
    ? journalChanges(snapshot, next.run.changes, next.command.capability.id)
    : {};
  const touched = [...run.touched, ...(next?.run.touched ?? [])];
  const receipt: CommandReceipt = {
    ...receiptOf(snapshot, capability.id, result, { ...revisions, ...continued }, touched),
    ...(next
      ? { continuation: { operation: next.command.capability.id, result: next.result } }
      : {}),
  };
  storeReceipt(snapshot, command, receipt, next?.command);
  const changeCount = run.changes.size + (next?.run.changes.size ?? 0);
  await auditAccepted(kernel, command, snapshot, revisions, changeCount);
  if (next) await auditAccepted(kernel, next.command, snapshot, continued, next.run.changes.size);
  report(touched, false);
  return receipt;
}

async function invokeCommand<State, Services>(
  kernel: Kernel<State, Services>,
  request: Invocation,
  context: ExecutionContext,
  correlationId: string,
  report: Report,
): Promise<CommandReceipt> {
  const command = prepareCommand(kernel, request, context, correlationId);
  return kernel.options.storage.transact(context.workspaceId, async (snapshot) => {
    const stored = command.key === undefined ? undefined : snapshot.receipts[command.key];
    if (!stored) return execute(kernel, command, snapshot, report);
    const receipt = await replay(kernel, command, snapshot, stored);
    report([], true);
    return receipt;
  });
}

/**
 * Audit ordering for commands:
 * 1. Refusals and failures are recorded after the transaction has rolled back.
 * 2. `command.accepted` is appended inside the transaction, after the final commit-phase
 *    authorization and before the callback returns. If the log is required and the append
 *    fails, the callback throws UNAVAILABLE and storage commits nothing.
 * 3. `command.committed` and outbox events are appended after the commit. A crash between 2
 *    and 3 leaves an accepted event without an outcome; `recoverAudit` resolves it against the
 *    journal on the next start.
 * The append in step 2 is local, fsynced file I/O under the storage lock, never a network call.
 */
export function createCommands<State, Services>(kernel: Kernel<State, Services>) {
  return async function invokeRaw(
    request: Invocation,
    context: ExecutionContext,
  ): Promise<CommandReceipt> {
    const correlationId = crypto.randomUUID();
    const operation = typeof request?.operation === 'string' ? request.operation : '';
    let transitions: Effect[] = [];
    let replayed = false;
    try {
      const receipt = await invokeCommand(
        kernel,
        request,
        context,
        correlationId,
        (effects, replay) => {
          transitions = effects;
          replayed = replay;
        },
      );
      await kernel.audit.after([
        {
          kind: replayed ? 'command.replayed' : 'command.committed',
          outcome: 'committed',
          operation,
          actor: actorOf(context),
          correlationId,
          cursor: receipt.cursor,
          resources: Object.keys(receipt.revisions).sort(),
        },
        ...effectRecords(transitions, context, correlationId),
      ]);
      return receipt;
    } catch (error) {
      if (kernel.audit.enabled)
        await kernel.audit.after([
          failureRecord('command', operation, context, correlationId, error),
        ]);
      throw error;
    }
  };
}

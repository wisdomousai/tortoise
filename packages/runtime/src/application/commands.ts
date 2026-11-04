import { ApplicationError } from '@tortoise/contracts';
import type {
  CommandResult,
  Effect,
  ExecutionContext,
  Invocation,
  StoredResult,
  WorkspaceSnapshot,
} from '../types.js';
import { actorOf, effectRecords, failureRecord } from './audit.js';
import {
  auditAccepted,
  journalChanges,
  commandResultOf,
  storeCommandResult,
} from './command-commit.js';
import { prepareCommand, type Command } from './command-request.js';
import { replayContinuation } from './continuation.js';
import { runFrame } from './frame.js';
import { authorize, project, type Kernel } from './kernel.js';
import { topFrame } from './nested.js';

type Report = (effects: Effect[], replay: boolean) => void;
/**
 * A retry returns the stored command result, reprojected for the caller's current grants. Every nested
 * command the first execution made is authorized again with the input it ran with, so a caller
 * who lost one of them cannot read the command result.
 */
async function replay<State, Services>(
  kernel: Kernel<State, Services>,
  command: Command<State, Services>,
  snapshot: WorkspaceSnapshot<State>,
  stored: StoredResult,
): Promise<CommandResult> {
  const { capability, input, context } = command;
  await authorize(kernel, capability, input, context, snapshot, 'replay');
  if (stored.fingerprint !== command.fingerprint)
    throw new ApplicationError(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key was used for another request',
    );
  for (const call of stored.calls ?? []) {
    const nested = kernel.capabilities.get(call.operation);
    if (!nested) throw new ApplicationError('NOT_FOUND', 'Unknown command');
    await authorize(kernel, nested, call.input, context, snapshot, 'replay', undefined, call.via);
  }
  const result = await project(
    kernel,
    capability,
    input,
    context,
    snapshot,
    stored.commandResult.result,
  );
  const continuation = await replayContinuation(kernel, command, snapshot, stored);
  await authorize(kernel, capability, input, context, snapshot, 'replay');
  return {
    ...stored.commandResult,
    result,
    ...(continuation ? { continuation } : {}),
    authorizationRevision: snapshot.authorizationRevision,
  };
}

/**
 * The transaction body of a first execution: the command's frame with the frames of the
 * commands it invoked and continued with, then journal, command result and audit for all of them.
 */
async function execute<State, Services>(
  kernel: Kernel<State, Services>,
  command: Command<State, Services>,
  snapshot: WorkspaceSnapshot<State>,
  report: Report,
): Promise<CommandResult> {
  const { capability } = command;
  const frame = topFrame(capability.id, command.correlationId);
  const { run, result, continuation } = await runFrame(kernel, command, snapshot, frame);
  const fromCursor = snapshot.cursor;
  const revisions = journalChanges(snapshot, run.changes, capability.id, frame.tree);
  const commandResult: CommandResult = {
    ...commandResultOf(snapshot, capability.id, result, revisions, run.touched),
    ...(continuation
      ? {
          continuation: {
            operation: continuation.command.capability.id,
            result: continuation.result,
          },
        }
      : {}),
  };
  storeCommandResult(snapshot, command, commandResult, frame.tree, continuation?.command);
  await auditAccepted(kernel, command, snapshot, revisions, fromCursor, frame.tree);
  report(run.touched, false);
  return commandResult;
}

async function invokeCommand<State, Services>(
  kernel: Kernel<State, Services>,
  request: Invocation,
  context: ExecutionContext,
  correlationId: string,
  report: Report,
): Promise<CommandResult> {
  const command = prepareCommand(kernel, request, context, correlationId);
  return kernel.options.storage.transact(context.workspaceId, async (snapshot) => {
    const stored = command.key === undefined ? undefined : snapshot.commandResults[command.key];
    if (!stored) return execute(kernel, command, snapshot, report);
    const commandResult = await replay(kernel, command, snapshot, stored);
    report([], true);
    return commandResult;
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
  ): Promise<CommandResult> {
    const correlationId = crypto.randomUUID();
    const operation = typeof request?.operation === 'string' ? request.operation : '';
    let transitions: Effect[] = [];
    let replayed = false;
    try {
      const commandResult = await invokeCommand(
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
          cursor: commandResult.cursor,
          resources: Object.keys(commandResult.revisions).sort(),
        },
        ...effectRecords(transitions, context, correlationId),
      ]);
      return commandResult;
    } catch (error) {
      if (kernel.audit.enabled)
        await kernel.audit.after([
          failureRecord('command', operation, context, correlationId, error),
        ]);
      throw error;
    }
  };
}

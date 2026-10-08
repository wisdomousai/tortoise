import { ApplicationError } from '@agent-native/contracts';
import type {
  CommandReceipt,
  Effect,
  ExecutionContext,
  Invocation,
  StoredReceipt,
  WorkspaceSnapshot,
} from '../types.js';
import { sameState } from '../state-equality.js';
import { actorOf, effectRecords, failureRecord } from './audit.js';
import { auditAccepted, journalChanges, receiptOf, storeReceipt } from './command-commit.js';
import { prepareCommand, type Command } from './command-request.js';
import { grantCoversResource } from './delegation.js';
import { createHandlerContext, type HandlerScope } from './handler-context.js';
import { authorize, project, type Kernel } from './kernel.js';
import { revisionOf } from './records.js';

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
  await authorize(kernel, capability, input, context, snapshot, 'replay');
  return { ...stored.receipt, result, authorizationRevision: snapshot.authorizationRevision };
}

/**
 * A precondition reveals a revision, so it is a read: check grant scope and read policy for every
 * key before comparing any. Hidden and nonexistent keys get the same denial, raised before the
 * first comparison, so a CONFLICT never distinguishes them.
 */
async function checkPreconditions<State, Services>(
  kernel: Kernel<State, Services>,
  command: Command<State, Services>,
  snapshot: WorkspaceSnapshot<State>,
) {
  const { context, capability, expected } = command;
  for (const resource of Object.keys(expected))
    if (
      !grantCoversResource(context.grant, resource) ||
      !(await kernel.options.authorization.canReadEvent({
        event: {
          cursor: snapshot.cursor,
          resource,
          revision: revisionOf(snapshot, resource),
          type: 'precondition',
          operation: capability.id,
        },
        context,
        state: snapshot.state,
      }))
    )
      throw new ApplicationError('FORBIDDEN', 'Expected revision is not readable');
  for (const [resource, revision] of Object.entries(expected))
    if (revisionOf(snapshot, resource) !== revision)
      throw new ApplicationError('CONFLICT', 'Resource revision changed', { resource });
}

/** Run the handler on the draft and refuse writes it did not declare. */
async function runHandler<State, Services>(
  kernel: Kernel<State, Services>,
  command: Command<State, Services>,
  snapshot: WorkspaceSnapshot<State>,
) {
  const previousState = structuredClone(snapshot.state);
  const previousAuthorizationRevision = snapshot.authorizationRevision;
  const scope: HandlerScope<State> = {
    snapshot,
    context: command.context,
    operation: command.capability.id,
    query: false,
    changes: new Map(),
    touched: [],
  };
  const output = await command.handler.handle(command.input, createHandlerContext(kernel, scope));
  // Outbox writes ride on a declared business change so subscribers observe the same commit.
  if (scope.touched.some((effect) => !scope.changes.has(effect.resource)))
    throw new ApplicationError('INTERNAL', 'Effects require a declared changed resource');
  if (
    scope.changes.size === 0 &&
    snapshot.authorizationRevision === previousAuthorizationRevision &&
    !sameState(previousState, snapshot.state)
  )
    throw new ApplicationError('INTERNAL', 'State changes require a change-journal declaration');
  return { output, previousState, changes: scope.changes, touched: scope.touched };
}

/** The transaction body of a first execution: authorize, check, run, recheck, journal, audit. */
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
  const revisions = journalChanges(snapshot, run.changes, capability.id);
  const receipt = receiptOf(snapshot, capability.id, result, revisions, run.touched);
  storeReceipt(snapshot, command, receipt);
  await auditAccepted(kernel, command, snapshot, revisions, run.changes.size);
  report(run.touched, false);
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

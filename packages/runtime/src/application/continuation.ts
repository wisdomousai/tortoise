import { ApplicationError } from '@agent-native/contracts';
import type { CommandReceipt, Invocation, StoredReceipt, WorkspaceSnapshot } from '../types.js';
import { applyBlobChanges } from './blob-references.js';
import { checkPreconditions, runHandler } from './command-steps.js';
import { prepareCommand, type Command } from './command-request.js';
import { authorize, project, type Kernel } from './kernel.js';

/**
 * Run the command a handler continued with, inside the parent command's transaction and under
 * the parent's context. Ordering matches a direct call: grant, invoke authorization,
 * preconditions, handler, projection, commit authorization, then the grant again. It has no
 * idempotency key of its own; the parent's receipt covers both, so a retry of the parent never
 * runs it twice. Any refusal throws and rolls back the parent too.
 */
export async function runContinuation<State, Services>(
  kernel: Kernel<State, Services>,
  parent: Command<State, Services>,
  snapshot: WorkspaceSnapshot<State>,
  invocation: Invocation,
) {
  const { idempotencyKey: _ignored, ...request } = invocation;
  const command = prepareCommand(kernel, request, parent.context, parent.correlationId);
  if (command.capability.id === parent.capability.id)
    throw new ApplicationError('INTERNAL', 'A command cannot continue with itself');
  const { capability, input, context } = command;
  await authorize(kernel, capability, input, context, snapshot, 'invoke');
  await checkPreconditions(kernel, command, snapshot);
  const run = await runHandler(kernel, command, snapshot, true);
  const result = await project(kernel, capability, input, context, snapshot, run.output);
  await applyBlobChanges(kernel, context, snapshot, run.blobs);
  await authorize(kernel, capability, input, context, snapshot, 'commit', run.previousState);
  kernel.guard.active(context, capability.id);
  return { command, run, result };
}

/**
 * A replayed receipt's continuation, reprojected for the caller's current grants: the
 * continued operation is authorized for replay with the input it ran with, like the parent.
 */
export async function replayContinuation<State, Services>(
  kernel: Kernel<State, Services>,
  parent: Command<State, Services>,
  snapshot: WorkspaceSnapshot<State>,
  stored: StoredReceipt,
): Promise<CommandReceipt['continuation']> {
  const continued = stored.continuation;
  const recorded = stored.receipt.continuation;
  if (!continued || !recorded) return undefined;
  const capability = kernel.capabilities.get(continued.operation);
  if (!capability) throw new ApplicationError('NOT_FOUND', 'Unknown command');
  const { input } = continued;
  await authorize(kernel, capability, input, parent.context, snapshot, 'replay');
  const result = await project(
    kernel,
    capability,
    input,
    parent.context,
    snapshot,
    recorded.result,
  );
  return { operation: continued.operation, result };
}

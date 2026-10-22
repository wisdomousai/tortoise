import { ApplicationError } from '@agent-native/contracts';
import type { CommandReceipt, Invocation, StoredReceipt, WorkspaceSnapshot } from '../types.js';
import { prepareCommand, type Command } from './command-request.js';
import { runFrame } from './frame.js';
import { authorize, project, type Kernel } from './kernel.js';

/**
 * Run the command a handler continued with, inside the parent command's transaction and under
 * the parent's context, in a frame of its own (see `runFrame`). It has no
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
  return runFrame(kernel, command, snapshot, true);
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

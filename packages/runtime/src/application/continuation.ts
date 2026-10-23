import { ApplicationError } from '@agent-native/contracts';
import type { CommandReceipt, Invocation, StoredReceipt, WorkspaceSnapshot } from '../types.js';
import { prepareCommand, type Command } from './command-request.js';
import { runFrame } from './frame.js';
import { authorize, project, type Kernel } from './kernel.js';
import { enter, type FrameScope } from './nested.js';

/**
 * Run the command a handler continued with as a tail frame of the handler's frame: after the
 * handler's own frame finished, in the same transaction, under the same context and the same
 * call limits, so the caller must declare it in `invokes`. It has no idempotency key of its own;
 * the top-level receipt covers it, so a retry never runs it twice. Any refusal throws and rolls
 * back the caller too.
 */
export async function runContinuation<State, Services>(
  kernel: Kernel<State, Services>,
  parent: Command<State, Services>,
  snapshot: WorkspaceSnapshot<State>,
  frame: FrameScope,
  invocation: Invocation,
) {
  const { idempotencyKey: _ignored, ...request } = invocation;
  const command = prepareCommand(kernel, request, parent.context, parent.correlationId);
  return runFrame(
    kernel,
    command,
    snapshot,
    enter(kernel, frame, command.capability, command.input),
  );
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
  const via = [parent.capability.id];
  await authorize(kernel, capability, input, parent.context, snapshot, 'replay', undefined, via);
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

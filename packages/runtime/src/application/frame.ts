import type { WorkspaceSnapshot } from '../types.js';
import { applyBlobChanges } from './blob-references.js';
import type { Command } from './command-request.js';
import { checkPreconditions, runHandler } from './command-steps.js';
import { authorize, project, type Kernel } from './kernel.js';
import { runContinuation } from './continuation.js';
import { viaOf, type FrameScope } from './nested.js';

/**
 * One command's steps inside a transaction, in this order: invoke-phase authorization,
 * preconditions, handler, output projection, blob references, commit-phase authorization over
 * the previous and the proposed state, then the grant again. The commit-phase authorization
 * comes after the blob checks, so the context is rechecked after their awaits. A nested frame
 * passes its enclosing operations to both authorizations as `via`. Then the command the handler
 * continued with runs as a tail frame, and its changes and effects count as this frame's. Any
 * refusal throws and rolls back the whole transaction.
 */
export async function runFrame<State, Services>(
  kernel: Kernel<State, Services>,
  command: Command<State, Services>,
  snapshot: WorkspaceSnapshot<State>,
  frame: FrameScope,
): Promise<Frame<State, Services>> {
  const { capability, input, context } = command;
  const via = viaOf(frame);
  await authorize(kernel, capability, input, context, snapshot, 'invoke', undefined, via);
  await checkPreconditions(kernel, command, snapshot);
  const run = await runHandler(kernel, command, snapshot, frame);
  const result = await project(kernel, capability, input, context, snapshot, run.output);
  await applyBlobChanges(kernel, context, snapshot, run.blobs);
  await authorize(kernel, capability, input, context, snapshot, 'commit', run.previousState, via);
  kernel.guard.active(context, capability.id);
  if (!run.continuation) return { command, run, result };
  const tail = await runContinuation(kernel, command, snapshot, frame, run.continuation);
  for (const [resource, type] of tail.run.changes) run.changes.set(resource, type);
  run.touched.push(...tail.run.touched);
  return { command, run, result, continuation: { command: tail.command, result: tail.result } };
}

/** A finished frame: its run, its projected result and the command it continued with. */
export interface Frame<State, Services> {
  readonly command: Command<State, Services>;
  readonly run: Awaited<ReturnType<typeof runHandler<State, Services>>>;
  readonly result: unknown;
  readonly continuation?: { readonly command: Command<State, Services>; readonly result: unknown };
}

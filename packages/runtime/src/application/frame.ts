import type { WorkspaceSnapshot } from '../types.js';
import { applyBlobChanges } from './blob-references.js';
import type { Command } from './command-request.js';
import { checkPreconditions, runHandler } from './command-steps.js';
import { authorize, project, type Kernel } from './kernel.js';

/**
 * One command's steps inside a transaction, in this order: invoke-phase authorization,
 * preconditions, handler, output projection, blob references, commit-phase authorization over
 * the previous and the proposed state, then the grant again. The commit-phase authorization
 * comes after the blob checks, so the context is rechecked after their awaits. Any refusal
 * throws and rolls back the whole transaction. `continued` marks a command run by
 * `continueWith`, which may not continue again.
 */
export async function runFrame<State, Services>(
  kernel: Kernel<State, Services>,
  command: Command<State, Services>,
  snapshot: WorkspaceSnapshot<State>,
  continued = false,
) {
  const { capability, input, context } = command;
  await authorize(kernel, capability, input, context, snapshot, 'invoke');
  await checkPreconditions(kernel, command, snapshot);
  const run = await runHandler(kernel, command, snapshot, continued);
  const result = await project(kernel, capability, input, context, snapshot, run.output);
  await applyBlobChanges(kernel, context, snapshot, run.blobs);
  await authorize(kernel, capability, input, context, snapshot, 'commit', run.previousState);
  kernel.guard.active(context, capability.id);
  return { command, run, result };
}

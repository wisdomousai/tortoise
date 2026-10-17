import { ApplicationError } from '@agent-native/contracts';
import type { Invocation, WorkspaceSnapshot } from '../types.js';
import { sameState } from '../state-equality.js';
import type { Command } from './command-request.js';
import { grantCoversResource } from './delegation.js';
import { createHandlerContext, type HandlerScope } from './handler-context.js';
import type { Kernel } from './kernel.js';
import { revisionOf } from './records.js';

/**
 * A precondition reveals a revision, so it is a read: check grant scope and read policy for every
 * key before comparing any. Hidden and nonexistent keys get the same denial, raised before the
 * first comparison, so a CONFLICT never distinguishes them.
 */
export async function checkPreconditions<State, Services>(
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

/**
 * Run the handler on the draft and refuse writes it did not declare. `continued` marks a command
 * run by `continueWith`, which may not continue again.
 */
export async function runHandler<State, Services>(
  kernel: Kernel<State, Services>,
  command: Command<State, Services>,
  snapshot: WorkspaceSnapshot<State>,
  continued = false,
) {
  const previousState = structuredClone(snapshot.state);
  const previousAuthorizationRevision = snapshot.authorizationRevision;
  const scope: HandlerScope<State> = {
    snapshot,
    context: command.context,
    operation: command.capability.id,
    input: command.input,
    query: false,
    changes: new Map(),
    touched: [],
    continued,
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
  const continuation: Invocation | undefined = scope.continuation;
  return { output, previousState, changes: scope.changes, touched: scope.touched, continuation };
}

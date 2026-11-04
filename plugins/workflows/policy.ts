import { isDelegated, own, type AuthorizationPort } from '@tortoise/runtime';
import { RUN_PREFIX, runIdOf, workflowOperations as ops, workflowsModule } from './contracts';
import type { WorkflowsState } from './state';

const known = new Set<string>(workflowsModule.capabilities.map((capability) => capability.id));
const runner = new Set<string>([ops.advance.id, ops.fail.id]);

/**
 * Starting is open to any caller except a workflow run, so an instance never starts another.
 * Retrying and resolving are for the starter as a person; cancelling is for the starter or a
 * workspace owner, which handlers check, as they filter reads. `workflow.due` is for an owner:
 * the runner reads it as the local owner. Advancing and recording a failure are allowed only for
 * the starter under the instance's run ID, a context only the in-process runner creates; each
 * step then passes the application's policy as the starter, inside that transaction.
 */
export const workflowsPolicy: AuthorizationPort<WorkflowsState> = {
  authorize({ capability, context, input, state }) {
    if (!known.has(capability.id)) return { allowed: false, reason: 'NO_POLICY' };
    if (capability.id === ops.start.id)
      return {
        allowed: context.runId?.startsWith(RUN_PREFIX) !== true,
        reason: 'NOT_FROM_A_WORKFLOW',
      };
    if (capability.id === ops.retry.id || capability.id === ops.resolve.id)
      return { allowed: !isDelegated(context), reason: 'PERSON_REQUIRED' };
    if (capability.id === ops.due.id)
      return { allowed: state.owners.includes(context.principalId), reason: 'RUNNER_ONLY' };
    if (runner.has(capability.id)) {
      const id = String((input as { id?: unknown }).id);
      const instance = own(state.instances, id);
      return {
        allowed:
          !!instance && instance.starter === context.principalId && context.runId === runIdOf(id),
        reason: 'RUNNER_ONLY',
      };
    }
    return { allowed: true };
  },
  canReadEvent({ event, context, state }) {
    const instance = own(state.instances, event.resource.slice('workflow:'.length));
    return (
      !!instance &&
      (instance.starter === context.principalId || state.owners.includes(context.principalId))
    );
  },
};

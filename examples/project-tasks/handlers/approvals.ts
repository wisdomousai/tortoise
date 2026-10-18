import { approvalHandlers as handlersOf } from '@agent-native/runtime';
import { operations } from '../contracts';
import type { ProjectTaskState } from '../domain';
import { projectOfResource, projectRole } from '../policy';
import type { ProjectTaskServices } from '../server/context';

/**
 * Requested task commands. Every approval request names the project or task it is about, the policy
 * resolves that record's project for submit, approve and reject, and an approval request is visible to the
 * project's members. Approving runs the task command under the approver's project role, so a
 * viewer's approval is refused by the command's own rule.
 */
export function approvalHandlers() {
  return handlersOf<ProjectTaskState, ProjectTaskServices>({
    store: (state) => state.approvals,
    commands: Object.values(operations).filter((operation) => operation.kind === 'command'),
    visible(approval, ctx) {
      const project = approval.resource && projectOfResource(ctx.state, approval.resource);
      return !!project && projectRole(ctx.state, ctx.context.principalId, project) !== undefined;
    },
    newId: (ctx) => (ctx.services.newId ?? (() => crypto.randomUUID()))(),
    now: (ctx) => (ctx.services.now ?? Date.now)(),
  });
}

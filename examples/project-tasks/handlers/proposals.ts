import { proposalHandlers as handlersOf } from '@agent-native/runtime';
import { operations } from '../contracts';
import type { ProjectTaskState } from '../domain';
import { projectOfResource, projectRole } from '../policy';
import type { ProjectTaskServices } from '../server/context';

/**
 * Proposed task commands. Every proposal names the project or task it is about, the policy
 * resolves that record's project for submit, accept and reject, and a proposal is visible to the
 * project's members. Accepting runs the task command under the accepter's project role, so a
 * viewer's acceptance is refused by the command's own rule.
 */
export function proposalHandlers() {
  return handlersOf<ProjectTaskState, ProjectTaskServices>({
    store: (state) => state.proposals,
    commands: Object.values(operations).filter((operation) => operation.kind === 'command'),
    visible(proposal, ctx) {
      const project = proposal.resource && projectOfResource(ctx.state, proposal.resource);
      return !!project && projectRole(ctx.state, ctx.context.principalId, project) !== undefined;
    },
    newId: (ctx) => (ctx.services.newId ?? (() => crypto.randomUUID()))(),
    now: (ctx) => (ctx.services.now ?? Date.now)(),
  });
}

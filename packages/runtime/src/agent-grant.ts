import { ApplicationError, type Catalog } from '@agent-native/contracts';
import type { DelegationGrant, ExecutionContext } from './types.js';

export interface AgentGrantOptions {
  /** The run the grant is bound to; set it so a leaked grant is useless to another run. */
  readonly runId?: string;
  /** Resources the run starts on, such as the person's selection or a trigger's resource. */
  readonly resources?: readonly string[];
  /** Operations a proposing agent uses to record proposals, added to its queries. */
  readonly proposalOperations?: readonly string[];
  readonly now: number;
}

const intersect = (allowed: readonly string[], limit: readonly string[] | undefined) =>
  limit ? allowed.filter((value) => limit.includes(value)) : [...allowed];

/**
 * The delegation grant a run under an agent definition executes with. It only narrows the
 * issuer's own context: operations are the definition's (a proposing agent's commands are left
 * out) within the issuer's grant, resources are the run's starting resources of the
 * definition's types within the issuer's resources, and it expires at the earlier of the
 * issuer's expiry and the definition's wall-time budget. It is bound to the issuer's principal
 * and workspace and to the run. Policy still authorizes every call; the grant cannot widen it.
 * Throws `NOT_FOUND` for an agent the catalog does not define.
 */
export function agentGrant(
  catalog: Catalog,
  agentId: string,
  issuer: Pick<ExecutionContext, 'principalId' | 'workspaceId' | 'grant'>,
  options: AgentGrantOptions,
): DelegationGrant {
  const agent = catalog.agents.find((candidate) => candidate.id === agentId);
  if (!agent) throw new ApplicationError('NOT_FOUND', `Unknown agent ${agentId}`);
  const kinds = new Map(catalog.operations.map((operation) => [operation.id, operation.kind]));
  const own =
    agent.output === 'direct'
      ? agent.operations
      : [
          ...agent.operations.filter((id) => kinds.get(id) === 'query'),
          ...(options.proposalOperations ?? []),
        ];
  const operations = intersect([...new Set(own)], issuer.grant?.operations);
  const types = agent.resourceTypes;
  const scoped = types
    ? (options.resources ?? []).filter((resource) =>
        types.some((type) => resource.startsWith(`${type}:`)),
      )
    : undefined;
  const resources = scoped
    ? intersect(scoped, issuer.grant?.resources)
    : issuer.grant?.resources && [...issuer.grant.resources];
  const budgetEnd = options.now + agent.budgets.wallTimeMs;
  const expiresAt = Math.min(issuer.grant?.expiresAt ?? budgetEnd, budgetEnd);
  return {
    operations,
    expiresAt,
    principalId: issuer.principalId,
    workspaceId: issuer.workspaceId,
    ...(resources ? { resources } : {}),
    ...(options.runId ? { runId: options.runId } : {}),
  };
}

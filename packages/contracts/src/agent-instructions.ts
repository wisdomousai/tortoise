import type { Catalog } from './catalog';

/**
 * What a model reads at the start of a run under an agent definition: the definition's
 * instructions and, for a requesting agent or a direct agent with `requests`, each command it may
 * request approval for with its description and
 * the input schema `approval.request` checks. A requesting run gets no tool for those commands, so
 * this is the only place its model learns their IDs and input shapes. Text only; the run's grant
 * and the policy decide what is called and accepted. Throws for an agent the catalog lacks.
 */
export function agentInstructions(catalog: Catalog, agentId: string): string {
  const agent = catalog.agents.find((candidate) => candidate.id === agentId);
  if (!agent) throw new Error(`Unknown agent ${agentId}`);
  if (agent.output === 'direct' && !agent.requests?.length) return agent.instructions;
  const requested = agent.output === 'direct' ? agent.requests! : agent.operations;
  const commands = requested.flatMap((id) => {
    const operation = catalog.operations.find((candidate) => candidate.id === id);
    return operation?.kind === 'command' ? [operation] : [];
  });
  if (commands.length === 0) return agent.instructions;
  const list = commands.map(({ id, description, inputSchema }) => {
    const { $schema: _schema, ...schema } = inputSchema;
    return `- \`${id}\`: ${description}\n  Input schema: ${JSON.stringify(schema)}`;
  });
  return [
    agent.instructions,
    agent.output === 'direct'
      ? 'You run your other commands yourself. These need a person’s approval: when a change needs one of them, or the application refuses you one of them, call approval.request with `operation` set to its command ID and `input` set to that command’s complete input, matching its schema. A person approves or rejects the request.'
      : 'You do not run commands yourself. To change something, call approval.request with `operation` set to one of these command IDs and `input` set to that command’s complete input, matching its schema. A person approves or rejects the request.',
    list.join('\n'),
    // Small models flatten the tool envelope around the approval request unless they see its shape.
    `The approval.request arguments look like this: ${JSON.stringify({ input: { operation: commands[0]!.id, input: { '…': '…' }, rationale: 'Why this change.' } })}`,
  ].join('\n\n');
}

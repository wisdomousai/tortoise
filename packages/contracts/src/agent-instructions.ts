import type { Catalog } from './catalog';

/**
 * What a model reads at the start of a run under an agent definition: the definition's
 * instructions and, for a proposing agent, each command it may propose with its description and
 * the input schema `proposal.submit` checks. A proposing run gets no tool for those commands, so
 * this is the only place its model learns their IDs and input shapes. Text only; the run's grant
 * and the policy decide what is called and accepted. Throws for an agent the catalog lacks.
 */
export function agentInstructions(catalog: Catalog, agentId: string): string {
  const agent = catalog.agents.find((candidate) => candidate.id === agentId);
  if (!agent) throw new Error(`Unknown agent ${agentId}`);
  if (agent.output === 'direct') return agent.instructions;
  const commands = agent.operations.flatMap((id) => {
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
    'You do not run commands yourself. To change something, call proposal.submit with `operation` set to one of these command IDs and `input` set to that command’s complete input, matching its schema. A person accepts or rejects the proposal.',
    list.join('\n'),
    // Small models flatten the tool envelope around the proposal unless they see its shape.
    `The proposal.submit arguments look like this: ${JSON.stringify({ input: { operation: commands[0]!.id, input: { '…': '…' }, rationale: 'Why this change.' } })}`,
  ].join('\n\n');
}

import { defineAgent } from '@tortoise/contracts';

/**
 * The repair triage agent: for a tool in repair it reads the tool's loans, whose damaged returns
 * carry the repair orders, and requests approval to retire a worn-out tool. It reads tools and
 * loans and holds no write of its own, so nothing changes until an attendant approves on the
 * Approvals screen.
 */
// #region agent
export const repairTriageAgent = defineAgent({
  id: 'tool-store.repair-triage',
  title: 'Repair triage',
  instructions: [
    'Triage tools in repair. Take the tools the person names, or list the tools with status in-repair with tool.list. Read each tool with tool.get and leave a tool whose status is not in-repair alone.',
    "For each tool in repair, list its loans with loan.list and the tool's id as toolId. A loan with condition damaged is a damaged return: returnedAt is when it came back, note is what the attendant noted, and repairOrder is its repair order with the EAM. The loan with the latest returnedAt is the latest return.",
    'Request approval for tool.retire with the toolId when either holds: the tool came back damaged three or more times in the 90 days up to and including its latest return (returnedAt no more than 7776000000 ms before the latest returnedAt), or the note of its latest return says the tool is beyond repair. Pass resource tool:<id>, baseRevisions with tool:<id> mapped to the revision tool.get returned, and a rationale that starts with the asset tag and names the rule that holds, the damaged returns and their repair order numbers.',
    'Otherwise request nothing for that tool. Request approval for no other command.',
  ].join(' '),
  operations: ['tool.list', 'tool.get', 'loan.list', 'loan.get', 'tool.retire'],
  model: 'any',
  output: 'request-approval',
  budgets: { turns: 8, toolCalls: 30, wallTimeMs: 180_000 },
});
// #endregion agent

import { z } from 'zod';
import { defineCapability, jsonSchema, recordKeySchema } from '@tortoise/contracts';
import { eamTarget } from './eam-target';
import { loanConditions, loanSchema } from './loan';

/**
 * Take a lent tool back and record its condition. A damaged return also sends a repair order to
 * the EAM through the outbox. Attendants only.
 */
export const toolReturn = defineCapability({
  id: 'tool.return',
  kind: 'command',
  description:
    'Take a lent tool back and record its condition. Closes the tool\'s open loan and sets the tool to available when the condition is ok, or to in-repair when it is damaged. A damaged return also sends a repair order with the asset tag, the note and the attendant to the EAM after the commit: the receipt does not mean the EAM accepted it, and the loan\'s repairOrder shows its answer. A tool that is not checked out is refused with CONFLICT. Pass the revision tool.get returned as expectedRevisions {"tool:<toolId>": revision}. A stale revision is refused with CONFLICT and nothing changes. Attendants only. A viewer is refused with FORBIDDEN.',
  input: jsonSchema(
    z.strictObject({
      toolId: recordKeySchema.describe('The key of the tool that is brought back.'),
      condition: z.enum(loanConditions).describe('The condition of the tool: ok or damaged.'),
      note: z
        .string()
        .max(500)
        .optional()
        .describe('What the attendant noticed, such as the damage.'),
    }),
  ),
  output: jsonSchema(loanSchema),
  permission: { action: 'write', resourceType: 'Tool' },
  dependencies: ['tool', 'loan'],
  integration: { target: eamTarget.target, delivery: 'outbox' },
  ui: { binding: 'tool.return' },
  display: {
    label: 'Return',
    resource: 'loan',
    titleField: 'assetTag',
    fields: [
      { name: 'toolId', label: 'Tool' },
      { name: 'condition', label: 'Condition' },
      { name: 'note', label: 'Note' },
    ],
  },
  audit: { fields: ['toolId', 'condition'] },
});

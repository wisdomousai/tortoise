import { z } from 'zod';
import { defineCapability, jsonSchema, recordKeySchema } from '@agent-native/contracts';
import { borrowerSchema, loanSchema } from './loan';

/** Lend an available tool to an employee for a work order. Attendants only. */
export const toolCheckOut = defineCapability({
  id: 'tool.check-out',
  kind: 'command',
  description:
    'Lend an available tool to an employee for a work order. A tool that is not available is refused with CONFLICT. Opens a loan and sets the tool to checked-out in one step; the receipt carries the revisions of tool:<id> and loan:<id>. Pass the revision tool.get returned as expectedRevisions {"tool:<toolId>": revision}. A stale revision is refused with CONFLICT and nothing changes. Attendants only. A viewer is refused with FORBIDDEN.',
  input: jsonSchema(
    z.strictObject({
      toolId: recordKeySchema.describe('The key of the tool to lend.'),
      borrower: borrowerSchema,
      workOrder: z.string().min(1).max(40).describe('The work order the tool is lent for.'),
      dueAt: z.iso
        .datetime({ offset: true })
        .describe(
          'When the tool is due back, as an ISO 8601 date and time such as 2026-11-05T16:00:00Z.',
        ),
    }),
  ),
  output: jsonSchema(loanSchema),
  permission: { action: 'write', resourceType: 'Tool' },
  dependencies: ['tool', 'loan'],
  ui: { binding: 'tool.check-out' },
  display: {
    label: 'Check out',
    resource: 'loan',
    titleField: 'assetTag',
    fields: [
      { name: 'toolId', label: 'Tool' },
      { name: 'borrower', label: 'Borrower' },
      { name: 'workOrder', label: 'Work order' },
      { name: 'dueAt', label: 'Due' },
    ],
  },
  audit: { fields: ['toolId'] },
});

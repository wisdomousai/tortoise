import { z } from 'zod';
import { defineCapability, jsonSchema, MAX_PAGE } from '@tortoise/contracts';
import { borrowerSchema, loanSchema } from './loan';

/** An open loan past its due time, with what the tool is. */
export const overdueLoanSchema = loanSchema.extend({
  description: z.string().describe('What the tool is, such as "Torque wrench 20-100 Nm".'),
});
export type OverdueLoan = z.output<typeof overdueLoanSchema>;

/** List open loans past their due time, oldest due first. Members. */
export const loanOverdue = defineCapability({
  id: 'loan.overdue',
  kind: 'query',
  description:
    "List open loans whose due time is before now, oldest due first, each with the tool's asset tag and description. A loan without a return time is open. Filter by borrower. The output's total counts every overdue loan that matches, before paging.",
  input: jsonSchema(
    z.strictObject({
      borrower: borrowerSchema.optional(),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Matching loans to skip before the page starts; 0 when left out.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE)
        .optional()
        .describe(
          `Most loans on the page, 1 to ${MAX_PAGE}. The output's total counts every match.`,
        ),
    }),
  ),
  output: jsonSchema(
    z.strictObject({
      items: z.array(overdueLoanSchema),
      total: z.number().int().min(0),
    }),
  ),
  permission: { action: 'read', resourceType: 'Loan' },
  dependencies: ['loan', 'tool'],
  ui: { binding: 'loan.overdue' },
  display: {
    label: 'Overdue loans',
    resource: 'loan',
    titleField: 'assetTag',
    fields: [
      { name: 'assetTag', label: 'Asset tag' },
      { name: 'description', label: 'Tool' },
      { name: 'borrower', label: 'Borrower' },
      { name: 'workOrder', label: 'Work order' },
      { name: 'dueAt', label: 'Due' },
    ],
  },
});

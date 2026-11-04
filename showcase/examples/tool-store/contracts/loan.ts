import { z } from 'zod';
import {
  collectionGet,
  collectionList,
  defineCollection,
  deliveryShape,
  recordKeySchema,
} from '@tortoise/contracts';

export const loanConditions = ['ok', 'damaged'] as const;

/** The employee number on a badge: E followed by six digits. The counter's scan route uses it too. */
export const borrowerPattern = /^E\d{6}$/;

/** The employee number of a borrower: E followed by six digits. */
export const borrowerSchema = z
  .string()
  .regex(borrowerPattern)
  .describe("The borrower's employee number: E followed by six digits, such as E004217.");

/**
 * Where the repair order of a damaged return stands with the EAM. `pending` until the EAM
 * answers, and also while a person reconciles a delivery whose outcome nobody could establish.
 */
export const repairOrderSchema = z.strictObject({
  effectId: z
    .string()
    .describe('The outbox effect that sends the repair order. A held delivery shows the same id.'),
  sync: deliveryShape.sync.describe(
    'pending until the EAM answers, accepted when it opened the repair order, rejected when it refused it.',
  ),
  sorRef: deliveryShape.sorRef.describe("The EAM's repair order number, once it accepted."),
  rejection: deliveryShape.rejection.describe(
    'Why the EAM refused the repair order, such as ASSET_UNKNOWN for an asset tag it does not know.',
  ),
});
export type RepairOrder = z.output<typeof repairOrderSchema>;

/** What a caller sees of one loan. A loan is open until `returnedAt` is set. */
export const loanSchema = z.strictObject({
  id: recordKeySchema,
  toolId: recordKeySchema.describe('The key of the tool that was lent.'),
  assetTag: z.string().describe('The asset tag of the tool, copied when the tool was lent.'),
  borrower: borrowerSchema,
  workOrder: z.string().min(1).max(40).describe('The work order the tool was lent for.'),
  dueAt: z.iso
    .datetime({ offset: true })
    .describe(
      'When the tool is due back, as an ISO 8601 date and time such as 2026-11-05T16:00:00Z.',
    ),
  checkedOutBy: z.string().describe('The attendant who lent the tool.'),
  checkedOutAt: z.number().int().nonnegative(),
  returnedAt: z.number().int().nonnegative().optional(),
  returnedBy: z.string().optional().describe('The attendant who took the tool back.'),
  condition: z.enum(loanConditions).optional().describe('The condition of the tool on return.'),
  note: z.string().max(500).optional().describe('What the attendant noted on return.'),
  repairOrder: repairOrderSchema
    .optional()
    .describe('The repair order a damaged return sent to the EAM.'),
});
export type Loan = z.output<typeof loanSchema>;

export const loans = defineCollection({
  type: 'loan',
  resourceType: 'Loan',
  item: loanSchema,
  label: { one: 'Loan', many: 'Loans' },
  titleField: 'assetTag',
  fields: [
    { name: 'assetTag', label: 'Asset tag' },
    { name: 'borrower', label: 'Borrower' },
    { name: 'workOrder', label: 'Work order' },
    { name: 'dueAt', label: 'Due' },
    { name: 'checkedOutAt', label: 'Checked out' },
    { name: 'returnedAt', label: 'Returned' },
    { name: 'condition', label: 'Condition' },
    { name: 'note', label: 'Note' },
  ],
});

/**
 * Reads of loans. Only `tool.check-out` and `tool.return` write them, so a loan and its tool's
 * status change together.
 */
export const loanOperations = {
  loanList: collectionList(loans, {
    id: 'loan',
    description:
      'List loans, newest first. Filter by tool, borrower or work order, or search the asset tag, borrower and work order. A loan without a return time is open.',
    filters: ['toolId', 'borrower', 'workOrder'],
    search: true,
  }),
  loanGet: collectionGet(loans, {
    id: 'loan',
    description:
      'Read one loan by id. A command receipt that changed it carries its revision as loan:<id> for expectedRevisions.',
  }),
} as const;

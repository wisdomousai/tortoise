import { z } from 'zod';
import {
  DESK_DISCOUNT_LIMIT,
  MAX_DISCOUNT,
  quoteCommand,
  quoteIdSchema,
  reasonSchema,
} from './quote';

/** Set the discount of a draft quote. Above 10 percent, supervisors only. Agents request approval. */
export const quoteDiscount = quoteCommand({
  id: 'quote.discount',
  description: `Set the discount percent and its reason on a draft quote and recompute the total. Call it when the desk grants a utility a discount. Returns the changed quote. Desk members set up to ${DESK_DISCOUNT_LIMIT} percent and supervisors up to ${MAX_DISCOUNT}. Above ${DESK_DISCOUNT_LIMIT} percent an agent requests approval instead of calling it, since the policy refuses an agent more with FORBIDDEN. A submitted or cancelled quote is CONFLICT.`,
  input: z.strictObject({
    id: quoteIdSchema,
    percent: z
      .number()
      .int()
      .min(0)
      .max(MAX_DISCOUNT)
      .describe(
        `The discount on the sum of the lines in whole percent, 0 to ${MAX_DISCOUNT}. It replaces the earlier one. Above ${DESK_DISCOUNT_LIMIT} needs a supervisor at the screen, and an agent requests approval for it.`,
      ),
    reason: reasonSchema.describe(
      'Why the desk gives the discount, such as "framework agreement 2026". It replaces the earlier reason.',
    ),
  }),
  label: 'Set discount',
  binding: true,
});

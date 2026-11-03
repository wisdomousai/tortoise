import { z } from 'zod';
import { quoteCommand, quoteIdSchema, reasonSchema } from './quote';

/** Cancel a draft or submitted quote with a reason. Desk. */
export const quoteCancel = quoteCommand({
  id: 'quote.cancel',
  description:
    'Cancel a draft or submitted quote, such as when the utility orders elsewhere. It needs a reason, which the quote keeps. Call it only when the person asks to withdraw the quote, since a cancelled quote stays cancelled. Returns the cancelled quote. Refuses a cancelled quote with CONFLICT. Desk members and supervisors only. A viewer is FORBIDDEN.',
  input: z.strictObject({
    id: quoteIdSchema,
    reason: reasonSchema.describe(
      'Why the quote is cancelled, such as "utility ordered elsewhere". Required, and the quote keeps it as its cancel reason.',
    ),
  }),
  label: 'Cancel quote',
  binding: true,
});

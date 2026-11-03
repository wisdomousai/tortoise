import { z } from 'zod';
import { quoteCommand, quoteIdSchema } from './quote';

/** Record that a draft quote went to the utility. Desk. */
export const quoteSubmit = quoteCommand({
  id: 'quote.submit',
  description:
    'Record that a draft quote went to the utility: its status becomes submitted and its lines and discount stay as they are. Call it only when the person confirms the quote is final. Returns the submitted quote. Sends nothing to another system. Refuses a submitted or cancelled quote with CONFLICT. Desk members and supervisors only. A viewer is FORBIDDEN.',
  input: z.strictObject({ id: quoteIdSchema }),
  label: 'Submit quote',
  binding: true,
});

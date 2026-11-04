import { z } from 'zod';
import {
  collectionCreate,
  collectionGet,
  collectionList,
  collectionUpdate,
  defineCollection,
  recordKeySchema,
} from '@tortoise/contracts';
import { serialSchema } from './transformer';

/** What a caller sees of one inquiry: a utility's call to the desk. */
export const inquirySchema = z.strictObject({
  id: recordKeySchema,
  caller: z
    .string()
    .min(1)
    .max(200)
    .describe('The person who called, as they gave their name, such as "J. Weber".'),
  customerId: recordKeySchema.describe(
    'The ID of the utility the caller works for, as customer.list or transformer.find returns it.',
  ),
  transformerSerial: serialSchema
    .optional()
    .describe(
      "The whole serial of the transformer the call is about, such as TR-40417, when the caller named one. It must be one of the utility's transformers.",
    ),
  subject: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'What the caller asked for, in one line, such as "Two HV bushings after a flashover".',
    ),
  status: z
    .enum(['open', 'quoted', 'closed'])
    .describe(
      'Where the call stands: open until the desk quotes, quoted once it has, closed when nothing is left to do.',
    ),
  createdBy: z.string(),
  createdAt: z.number().int().nonnegative(),
});
export type Inquiry = z.output<typeof inquirySchema>;

export const inquiries = defineCollection({
  type: 'inquiry',
  resourceType: 'Inquiry',
  item: inquirySchema,
  label: { one: 'Inquiry', many: 'Inquiries' },
  titleField: 'subject',
  fields: [
    { name: 'subject' },
    { name: 'caller' },
    { name: 'transformerSerial', label: 'Transformer serial' },
    { name: 'status' },
    { name: 'customerId', label: 'Customer ID' },
  ],
});

/** Reads and writes of inquiries. Browser-safe. */
export const inquiryOperations = {
  inquiryList: collectionList(inquiries, {
    id: 'inquiry',
    description:
      "List the utilities' calls to the desk, newest first, with caller, utility, serial, subject and status. Call it to find the open calls or the calls of one utility. Filter by status or customerId, or search the subject, caller and serial. Returns one page and the total of matches. Any member may call it.",
    filters: ['status', 'customerId'],
    search: true,
  }),
  inquiryGet: collectionGet(inquiries, {
    id: 'inquiry',
    description:
      'Read one call to the desk by its ID, as inquiry.list returns it. Call it for the caller, utility, serial, subject and status of one call. Returns the record. An unknown ID is NOT_FOUND. A command receipt that changed it includes its revision as inquiry:<id>, for expectedRevisions. Any member may call it.',
  }),
  inquiryCreate: collectionCreate(inquiries, {
    id: 'inquiry',
    description:
      "Record a utility's call to the desk as an open inquiry. Call it when a call comes in. Returns the new record. Refuses an unknown utility or serial with NOT_FOUND and another utility's transformer with INVALID_INPUT. Desk members and supervisors only. A viewer is FORBIDDEN.",
    fields: ['caller', 'customerId', 'transformerSerial', 'subject'],
    dependencies: ['customer', 'transformer'],
  }),
  inquiryUpdate: collectionUpdate(inquiries, {
    id: 'inquiry',
    description:
      "Change an inquiry's caller, utility, serial, subject or status. Call it to close a call that needs nothing more, to reopen one or to correct it. quote.create sets its inquiry to quoted itself. A field left out keeps its value. Returns the changed record. Refuses unknown records with NOT_FOUND and another utility's transformer with INVALID_INPUT. Desk members and supervisors only.",
    fields: ['caller', 'customerId', 'transformerSerial', 'subject', 'status'],
    dependencies: ['customer', 'transformer'],
  }),
} as const;

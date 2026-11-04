import { z } from 'zod';
import {
  collectionCreate,
  collectionGet,
  collectionList,
  collectionUpdate,
  defineCollection,
  recordKeySchema,
} from '@tortoise/contracts';

/** What a caller sees of one customer: a utility that runs the plant's transformers. */
export const customerSchema = z.strictObject({
  id: recordKeySchema,
  account: z
    .string()
    .regex(/^U\d{4}$/)
    .describe(
      "The utility's account at the desk, U followed by four digits, such as U1042. Unique, and it never changes once the utility is added.",
    ),
  name: z
    .string()
    .min(1)
    .max(200)
    .describe('The name the utility trades under, such as "Stadtwerke Nordhafen".'),
  phone: z
    .string()
    .min(1)
    .max(40)
    .describe('The number the desk calls the utility back on, such as "+49 40 5550 1042".'),
  createdBy: z.string(),
  createdAt: z.number().int().nonnegative(),
});
export type Customer = z.output<typeof customerSchema>;

export const customers = defineCollection({
  type: 'customer',
  resourceType: 'Customer',
  item: customerSchema,
  label: { one: 'Customer', many: 'Customers' },
  titleField: 'account',
  fields: [{ name: 'account' }, { name: 'name' }, { name: 'phone' }],
});

/** Reads and writes of customers. Browser-safe. */
export const customerOperations = {
  customerList: collectionList(customers, {
    id: 'customer',
    description:
      'List the utilities the desk serves, newest first, with account, name and phone. Call it to look up a utility by account or name, or to get the customerId other operations take. search matches the account and the name. Returns one page and the total of matches. Any member may call it.',
    search: true,
  }),
  customerGet: collectionGet(customers, {
    id: 'customer',
    description:
      'Read one utility by its ID, such as the customerId of a transformer, inquiry or quote. Call it for the account, name and phone to call back. Returns the record. An unknown ID is NOT_FOUND. A command receipt that changed the utility includes its revision as customer:<id>, for expectedRevisions. Any member may call it.',
  }),
  customerCreate: collectionCreate(customers, {
    id: 'customer',
    description:
      'Add a utility the desk serves, with its account, name and phone. Call it only when a person asks to register a new utility. Returns the new record with its ID. Refuses an account already in use with CONFLICT. Desk members and supervisors only. A viewer is FORBIDDEN.',
    fields: ['account', 'name', 'phone'],
  }),
  customerUpdate: collectionUpdate(customers, {
    id: 'customer',
    description:
      "Change a utility's name or phone. Call it when the utility gives a new name or call-back number. A field left out keeps its value, and the account never changes. Returns the changed record. An unknown ID is NOT_FOUND. Desk members and supervisors only. A viewer is FORBIDDEN.",
    fields: ['name', 'phone'],
  }),
} as const;

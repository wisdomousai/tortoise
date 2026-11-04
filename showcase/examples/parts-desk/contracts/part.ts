import { z } from 'zod';
import {
  collectionCreate,
  collectionGet,
  collectionList,
  collectionUpdate,
  defineCollection,
  recordKeySchema,
} from '@tortoise/contracts';
import { modelSchema } from './transformer';

export const partCategories = ['bushing', 'tap-changer', 'gasket', 'relay'] as const;
export const assemblies = [
  'hv-bushings',
  'lv-bushings',
  'tap-changer',
  'tank-cover',
  'conservator',
  'protection',
] as const;

/** What a caller sees of one spare part the desk sells. */
export const partSchema = z.strictObject({
  id: recordKeySchema,
  partNumber: z
    .string()
    .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/)
    .max(40)
    .describe(
      'The part number, upper-case letters and digits joined by hyphens, such as BSH-145-1250. Unique, and it never changes once the part is added.',
    ),
  description: z
    .string()
    .min(1)
    .max(200)
    .describe('What the part is, such as "HV bushing 145 kV 1250 A, OIP".'),
  category: z
    .enum(partCategories)
    .describe('The kind of part: a bushing, a tap changer part, a gasket or a protection relay.'),
  assembly: z
    .enum(assemblies)
    .describe(
      'The assembly of the transformer the part belongs to, such as hv-bushings or tank-cover.',
    ),
  fits: z
    .array(modelSchema)
    .min(1)
    .max(20)
    .describe(
      "The transformer models the part fits, 1 to 20, such as PTX-40. part.search and the quote commands compare a transformer's model with this list.",
    ),
  unitPrice: z
    .number()
    .int()
    .nonnegative()
    .describe('The price of one unit in euro cents, so 1480000 is 14,800.00 euro.'),
  stock: z
    .number()
    .int()
    .nonnegative()
    .describe('Units on the shelf now. At 0 the part takes its lead time to supply.'),
  leadTimeDays: z
    .number()
    .int()
    .nonnegative()
    .max(730)
    .describe('Days to supply the part when none is on the shelf, 0 to 730.'),
  createdBy: z.string(),
  createdAt: z.number().int().nonnegative(),
});
export type Part = z.output<typeof partSchema>;

export const parts = defineCollection({
  type: 'part',
  resourceType: 'Part',
  item: partSchema,
  label: { one: 'Part', many: 'Parts' },
  titleField: 'partNumber',
  fields: [
    { name: 'partNumber', label: 'Part number' },
    { name: 'description' },
    { name: 'category' },
    { name: 'assembly' },
    { name: 'fits' },
    { name: 'unitPrice', label: 'Unit price (cents)' },
    { name: 'stock' },
    { name: 'leadTimeDays', label: 'Lead time (days)' },
  ],
});

/** Reads and writes of parts. Browser-safe. */
export const partOperations = {
  partList: collectionList(parts, {
    id: 'part',
    description:
      'List the spare parts in the catalog, newest first, with price, stock and lead time. Call it to browse the catalog by category or assembly. For the parts that fit one transformer, call part.search with its serial instead. search matches the part number and description. Returns one page and the total of matches. Any member may call it.',
    filters: ['category', 'assembly'],
    search: true,
  }),
  partGet: collectionGet(parts, {
    id: 'part',
    description:
      'Read one spare part by its ID, as part.list or part.search returns it. Call it for the current price, stock and lead time of a part whose ID you have. Returns the record. An unknown ID is NOT_FOUND. A command receipt that changed it includes its revision as part:<id>, for expectedRevisions. Any member may call it.',
  }),
  partCreate: collectionCreate(parts, {
    id: 'part',
    description:
      'Add a spare part to the catalog with the transformer models it fits, its price, stock and lead time. Call it only when a person asks to add a part. Returns the new record with its ID. Refuses a part number already in use with CONFLICT. Desk members and supervisors only. A viewer is FORBIDDEN.',
    fields: [
      'partNumber',
      'description',
      'category',
      'assembly',
      'fits',
      'unitPrice',
      'stock',
      'leadTimeDays',
    ],
  }),
  partUpdate: collectionUpdate(parts, {
    id: 'part',
    description:
      "Change a part's description, category, assembly, models, price, stock or lead time. Call it when a person corrects the catalog or counts the shelf. A field left out keeps its value, the part number never changes and lines already quoted keep their price. Returns the changed record. An unknown ID is NOT_FOUND. Desk members and supervisors only.",
    fields: ['description', 'category', 'assembly', 'fits', 'unitPrice', 'stock', 'leadTimeDays'],
  }),
} as const;

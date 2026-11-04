import { z } from 'zod';
import {
  collectionCreate,
  collectionGet,
  collectionList,
  collectionUpdate,
  defineCollection,
  recordKeySchema,
} from '@tortoise/contracts';

/** A transformer's serial on its rating plate. Inquiries and searches name a transformer by it. */
export const serialSchema = z
  .string()
  .regex(/^TR-\d{5}$/)
  .describe(
    'The whole serial on the rating plate, TR- followed by five digits in upper case, such as TR-40417. Unique to one transformer.',
  );

/** A design of the plant, such as PTX-40. Parts list the models they fit. */
export const modelSchema = z
  .string()
  .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/)
  .max(40)
  .describe(
    "The plant's design of the transformer, upper-case letters and digits joined by hyphens, such as PTX-40. A part fits a transformer when its fits list names this model.",
  );

/** What a caller sees of one transformer the plant built and a utility runs. */
export const transformerSchema = z.strictObject({
  id: recordKeySchema,
  serial: serialSchema,
  customerId: recordKeySchema.describe(
    'The ID of the utility that runs the transformer, as customer.list returns it.',
  ),
  model: modelSchema,
  ratingMva: z
    .number()
    .positive()
    .max(2000)
    .describe('The rated power in MVA from the rating plate, above 0 and up to 2000, such as 40.'),
  voltage: z
    .string()
    .min(1)
    .max(40)
    .describe('The rated voltages from the rating plate, such as "110/20 kV".'),
  substation: z
    .string()
    .min(1)
    .max(200)
    .describe('The substation the transformer stands in, such as "Nordhafen Ost".'),
  yearInService: z
    .number()
    .int()
    .min(1900)
    .max(2100)
    .describe('The year the transformer went into service, 1900 to 2100.'),
  tapChanger: z
    .string()
    .min(1)
    .max(100)
    .describe('The type of its on-load tap changer, such as "VR-400 vacuum, 17 positions".'),
  createdBy: z.string(),
  createdAt: z.number().int().nonnegative(),
});
export type Transformer = z.output<typeof transformerSchema>;

export const transformers = defineCollection({
  type: 'transformer',
  resourceType: 'Transformer',
  item: transformerSchema,
  label: { one: 'Transformer', many: 'Transformers' },
  titleField: 'serial',
  fields: [
    { name: 'serial' },
    { name: 'model' },
    { name: 'ratingMva', label: 'Rating (MVA)' },
    { name: 'voltage' },
    { name: 'substation' },
    { name: 'yearInService', label: 'In service since' },
    { name: 'tapChanger', label: 'Tap changer' },
    { name: 'customerId', label: 'Customer ID' },
  ],
});

/** Reads and writes of transformers. Browser-safe. */
export const transformerOperations = {
  transformerList: collectionList(transformers, {
    id: 'transformer',
    description:
      "List the transformers in service, newest first, with serial, utility, model, rating, voltage and substation. Call it to see a utility's transformers or every transformer of one model. For a serial a caller reads out, call transformer.find instead. search matches the serial and substation. Returns one page and the total of matches. Any member may call it.",
    filters: ['customerId', 'model'],
    search: true,
  }),
  transformerGet: collectionGet(transformers, {
    id: 'transformer',
    description:
      'Read one transformer by its ID, as transformer.list or transformer.find returns it. Call it for the rating plate data of a transformer whose ID you have. Returns the record. An unknown ID is NOT_FOUND. A command receipt that changed it includes its revision as transformer:<id>, for expectedRevisions. Any member may call it.',
  }),
  transformerCreate: collectionCreate(transformers, {
    id: 'transformer',
    description:
      'Add a transformer in service at a utility, with its rating plate data. Call it only when a person asks to register a transformer. Returns the new record with its ID. Refuses a serial already in use with CONFLICT and an unknown utility with NOT_FOUND. Desk members and supervisors only. A viewer is FORBIDDEN.',
    fields: [
      'serial',
      'customerId',
      'model',
      'ratingMva',
      'voltage',
      'substation',
      'yearInService',
      'tapChanger',
    ],
    dependencies: ['customer'],
  }),
  transformerUpdate: collectionUpdate(transformers, {
    id: 'transformer',
    description:
      "Change a transformer's utility, model or rating plate data. Call it when a person corrects the data or the transformer moves to another substation or utility. A field left out keeps its value, and the serial never changes. Returns the changed record. Refuses an unknown transformer or utility with NOT_FOUND. Desk members and supervisors only.",
    fields: [
      'customerId',
      'model',
      'ratingMva',
      'voltage',
      'substation',
      'yearInService',
      'tapChanger',
    ],
    dependencies: ['customer'],
  }),
} as const;

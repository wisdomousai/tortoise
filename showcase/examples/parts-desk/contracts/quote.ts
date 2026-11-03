import { z } from 'zod';
import {
  collectionGet,
  collectionList,
  defineCapability,
  defineCollection,
  jsonSchema,
  recordKeySchema,
} from '@agent-native/contracts';
import { partSchema } from './part';
import { serialSchema } from './transformer';

/** The largest discount on a quote, in percent. */
export const MAX_DISCOUNT = 30;
/** The largest discount a desk member or an agent run may set; above it, supervisors only. */
export const DESK_DISCOUNT_LIMIT = 10;
/** The most lines one quote holds. */
export const MAX_LINES = 50;

const partNumberSchema = partSchema.shape.partNumber.describe(
  'The part number, such as BSH-145-1250, as part.search returns it.',
);
const quantitySchema = z
  .number()
  .int()
  .min(1)
  .max(99)
  .describe('Units of the part the utility wants, 1 to 99.');
/** A reason a person gives, such as for a discount or a cancellation. */
export const reasonSchema = z.string().min(1).max(200);

/** One line of a quote: a part, how many and its price when the line was written. */
export const quoteLineSchema = z.strictObject({
  partNumber: partNumberSchema,
  description: partSchema.shape.description,
  quantity: quantitySchema,
  unitPrice: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "The part's unit price in euro cents, copied from the part when the line was written.",
    ),
});

/** The lines as the desk writes them. The handler copies the description and unit price. */
const linesInputSchema = z
  .array(z.strictObject({ partNumber: partNumberSchema, quantity: quantitySchema }))
  .min(1)
  .max(MAX_LINES)
  .describe(
    "The parts quoted and how many of each, 1 to 50 lines. Every part must fit the transformer's model. The command copies each part's description and current unit price onto its line.",
  );

/** What a caller sees of one quote: the parts the desk offers a utility for one transformer. */
export const quoteSchema = z.strictObject({
  id: recordKeySchema,
  number: z
    .string()
    .regex(/^Q-\d{5}$/)
    .describe('The quote number, Q- followed by five digits, assigned in order, such as Q-00042.'),
  customerId: recordKeySchema.describe('The ID of the utility the quote is for.'),
  transformerSerial: serialSchema,
  inquiryId: recordKeySchema
    .optional()
    .describe('The ID of the inquiry the quote answers, when it answers one.'),
  lines: z.array(quoteLineSchema).min(1).max(MAX_LINES),
  discountPercent: z
    .number()
    .int()
    .min(0)
    .max(MAX_DISCOUNT)
    .describe(`The discount on the sum of the lines, in whole percent from 0 to ${MAX_DISCOUNT}.`),
  discountReason: reasonSchema.optional().describe('Why the desk set the discount.'),
  status: z
    .enum(['draft', 'submitted', 'cancelled'])
    .describe(
      'draft while the desk works on it, submitted once sent to the utility, cancelled when withdrawn.',
    ),
  cancelReason: reasonSchema.optional().describe('Why the quote was cancelled.'),
  total: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'The sum of quantity times unit price over the lines, after the discount, in euro cents.',
    ),
  createdBy: z.string(),
  createdAt: z.number().int().nonnegative(),
});
export type Quote = z.output<typeof quoteSchema>;
export type QuoteLine = z.output<typeof quoteLineSchema>;

export const quotes = defineCollection({
  type: 'quote',
  resourceType: 'Quote',
  item: quoteSchema,
  label: { one: 'Quote', many: 'Quotes' },
  titleField: 'number',
  fields: [
    { name: 'number' },
    { name: 'status' },
    { name: 'transformerSerial', label: 'Transformer serial' },
    { name: 'lines' },
    { name: 'discountPercent', label: 'Discount (%)' },
    { name: 'total', label: 'Total (cents)' },
    { name: 'customerId', label: 'Customer ID' },
  ],
});

/**
 * The sum of the lines after the discount, in euro cents, rounded to the nearest cent. The
 * handlers store it as the quote's total, and the quote builder shows it before a command runs.
 */
export function totalOf(
  lines: readonly { readonly quantity: number; readonly unitPrice: number }[],
  discountPercent: number,
): number {
  const gross = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  return Math.round((gross * (100 - discountPercent)) / 100);
}

/** The ID input of a command on one quote. */
export const quoteIdSchema = recordKeySchema.describe(
  "The quote's ID, as quote.list or a quote command returns it, not its Q- number.",
);

/**
 * A command that changes one quote and returns it, presented as the generated collection
 * commands are. Without `binding` it is headless until a screen binds it.
 */
export function quoteCommand<const Id extends string, I>(spec: {
  readonly id: Id;
  readonly description: string;
  readonly input: z.ZodType<I>;
  readonly label: string;
  /** Resources other than quotes that the handler reads. */
  readonly dependencies?: readonly string[];
  readonly binding?: boolean;
  readonly invokes?: readonly string[];
}) {
  return defineCapability({
    id: spec.id,
    kind: 'command',
    description: spec.description,
    input: jsonSchema(spec.input),
    output: jsonSchema(quoteSchema),
    permission: { action: 'write', resourceType: quotes.resourceType },
    dependencies: [quotes.type, ...(spec.dependencies ?? [])],
    ui: spec.binding ? { binding: spec.id } : { exception: 'headless until a screen binds it' },
    display: {
      label: spec.label,
      resource: quotes.type,
      key: quotes.key,
      titleField: 'number',
      fields: quotes.fields,
    },
    ...(spec.invokes ? { invokes: spec.invokes } : {}),
  });
}

/** Reads of quotes, and the commands that write a quote's lines. Browser-safe. */
export const quoteOperations = {
  quoteList: collectionList(quotes, {
    id: 'quote',
    description:
      "List quotes, newest first, with number, status, transformer serial, lines, discount and total. Call it to find a utility's quotes, the open drafts or a quote by its Q- number. Filter by status or customerId, or search the number and serial. Returns one page and the total of matches. Any member may call it.",
    filters: ['status', 'customerId'],
    search: true,
  }),
  quoteGet: collectionGet(quotes, {
    id: 'quote',
    description:
      'Read one quote by its ID, as quote.list returns it. Call it for the lines, discount, status and total before you change a quote. Returns the record. An unknown ID is NOT_FOUND. A command receipt that changed it includes its revision as quote:<id>, for expectedRevisions. Any member may call it.',
  }),
  quoteCreate: quoteCommand({
    id: 'quote.create',
    description:
      "Draft a quote without a discount for one of a utility's transformers. Call it when a person asks for a quote. Returns the draft with its Q- number and total. With an inquiryId it sets that inquiry to quoted. Refuses another utility's transformer or inquiry and a part that does not fit the model with INVALID_INPUT, and unknown ones with NOT_FOUND. Desk members and supervisors only.",
    input: z.strictObject({
      customerId: recordKeySchema.describe(
        'The ID of the utility the quote is for, as customer.list or transformer.find returns it.',
      ),
      transformerSerial: serialSchema.describe(
        "The whole serial of one of that utility's transformers, TR- followed by five digits in upper case, such as TR-40417.",
      ),
      lines: linesInputSchema,
      inquiryId: recordKeySchema
        .optional()
        .describe(
          "The ID of the utility's inquiry that the quote answers, as inquiry.list returns it. Leave it out for a quote without a call.",
        ),
    }),
    label: 'New Quote',
    dependencies: ['customer', 'transformer', 'part', 'inquiry'],
    binding: true,
    invokes: ['inquiry.update'],
  }),
  quoteUpdate: quoteCommand({
    id: 'quote.update',
    description:
      "Replace every line of a draft quote. Call it when the utility adds, drops or changes parts or quantities. Each line copies the part's current price again, the discount stays and the total follows. Returns the changed quote. Refuses a submitted or cancelled quote with CONFLICT and a part that does not fit with INVALID_INPUT. Desk members and supervisors only.",
    input: z.strictObject({ id: quoteIdSchema, lines: linesInputSchema }),
    label: 'Save Quote',
    dependencies: ['transformer', 'part'],
    binding: true,
  }),
} as const;

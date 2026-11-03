import { z } from 'zod';
import { defineCapability, jsonSchema, MAX_PAGE } from '@agent-native/contracts';
import { partCategories, partSchema } from './part';

/** Search parts by transformer, category and text. Members. */
export const partSearch = defineCapability({
  id: 'part.search',
  kind: 'query',
  description:
    "Search the spare parts for a transformer by category and text. Call it to answer which parts fit, what they cost and whether they are in stock. It needs the transformer's whole serial to return only fitting parts, and searches the whole catalog without one. Returns one page ordered by part number and the total of matches. An unknown serial is NOT_FOUND. Any member may call it.",
  input: jsonSchema(
    z.strictObject({
      transformerSerial: z
        .string()
        .min(1)
        .max(32)
        .optional()
        .describe(
          'The whole serial of the transformer the parts must fit, such as TR-40417. Case does not matter. When the caller gave only part of it, call transformer.find first.',
        ),
      category: z
        .enum(partCategories)
        .optional()
        .describe('Only parts of this kind: bushing, tap-changer, gasket or relay.'),
      text: z
        .string()
        .max(100)
        .optional()
        .describe(
          'Text matched case-insensitively against the part number and description, such as "gasket" or "BSH-145".',
        ),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          'Matching parts to skip before the page starts, 0 when left out. Add the page size to read the next page.',
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE)
        .optional()
        .describe(
          `Most parts on the page, 1 to ${MAX_PAGE}. The output's total counts every match, so a total above offset plus the items means more pages follow.`,
        ),
    }),
  ),
  output: jsonSchema(
    z.strictObject({
      items: z.array(partSchema),
      total: z.number().int().min(0).describe('Parts matching the search, before paging.'),
    }),
  ),
  permission: { action: 'read', resourceType: 'Part' },
  dependencies: ['part', 'transformer'],
  ui: { binding: 'part.search' },
  display: {
    label: 'Search parts',
    resource: 'part',
    titleField: 'partNumber',
    fields: [
      { name: 'partNumber', label: 'Part number' },
      { name: 'description' },
      { name: 'category' },
      { name: 'stock' },
      { name: 'leadTimeDays', label: 'Lead time (days)' },
      { name: 'unitPrice', label: 'Unit price (cents)' },
    ],
  },
});

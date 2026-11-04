import { z } from 'zod';
import { defineCapability, jsonSchema } from '@tortoise/contracts';
import { transformerSchema } from './transformer';

/** The most transformers one find returns. */
export const FIND_LIMIT = 10;

/** Find transformers by serial, whole or partial. Members. */
// #region description
export const transformerFind = defineCapability({
  id: 'transformer.find',
  kind: 'query',
  description: `Find a transformer by the serial a caller reads off its rating plate, whole or partial, such as TR-404. Call it first whenever a call names a transformer. Returns up to ${FIND_LIMIT} matches with their utility's name, an exact match first, and the total of matches. More than one match means asking the person which one. No match returns an empty list. Any member may call it.`,
  input: jsonSchema(
    z.strictObject({
      serial: z
        .string()
        .min(1)
        .max(32)
        .describe(
          'The serial as the caller reads it off the rating plate, whole or its first characters, such as TR-404 or tr-40417. Case and surrounding spaces do not matter.',
        ),
    }),
  ),
  // #endregion description
  output: jsonSchema(
    z.strictObject({
      items: z.array(
        transformerSchema.extend({
          customerName: z.string().optional().describe("The name of the transformer's utility."),
        }),
      ),
      total: z.number().int().min(0).describe('Transformers the text matches, before the limit.'),
    }),
  ),
  permission: { action: 'read', resourceType: 'Transformer' },
  dependencies: ['transformer', 'customer'],
  ui: { binding: 'transformer.find' },
  display: {
    label: 'Find transformer',
    resource: 'transformer',
    titleField: 'serial',
    fields: [
      { name: 'serial' },
      { name: 'customerName', label: 'Utility' },
      { name: 'model' },
      { name: 'ratingMva', label: 'Rating (MVA)' },
      { name: 'voltage' },
      { name: 'substation' },
    ],
  },
});

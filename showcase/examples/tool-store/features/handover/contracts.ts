import { z } from 'zod';
import {
  defineCapability,
  defineFeatureManifest,
  defineModule,
  jsonSchema,
  recordKeySchema,
} from '@agent-native/contracts';

/** The store shifts a handover entry can be written for. */
export const handoverShifts = ['early', 'late', 'night'] as const;
export const handoverShiftSchema = z.enum(handoverShifts);
export type HandoverShift = z.output<typeof handoverShiftSchema>;

/** One entry of the handover log: what one shift tells the next. */
export const handoverEntrySchema = z.strictObject({
  id: recordKeySchema,
  shift: handoverShiftSchema,
  text: z.string().min(1).max(500),
  recordedBy: z.string(),
  recordedAt: z.number().int().nonnegative(),
});
export type HandoverEntry = z.output<typeof handoverEntrySchema>;

/** The handover feature's operations. Browser-safe; every ID starts with `handover.`. */
export const handoverOperations = {
  handoverList: defineCapability({
    id: 'handover.list',
    kind: 'query',
    description: 'List handover entries, newest first.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({ items: z.array(handoverEntrySchema) })),
    permission: { action: 'read', resourceType: 'handover' },
    ui: { binding: 'handover.list' },
  }),
  handoverRecord: defineCapability({
    id: 'handover.record',
    kind: 'command',
    description: 'Record one handover entry for a shift. People only; an agent run is refused.',
    input: jsonSchema(
      z.strictObject({
        shift: handoverEntrySchema.shape.shift,
        text: handoverEntrySchema.shape.text,
      }),
    ),
    output: jsonSchema(handoverEntrySchema),
    permission: { action: 'record', resourceType: 'handover' },
    ui: { binding: 'handover.record' },
  }),
} as const;

/** The browser-safe part the application lists in `defineManifest({ features })`. */
export const handoverFeatureManifest = defineFeatureManifest({
  id: 'handover',
  title: 'Handover',
  modules: [defineModule({ id: 'handover', capabilities: Object.values(handoverOperations) })],
});

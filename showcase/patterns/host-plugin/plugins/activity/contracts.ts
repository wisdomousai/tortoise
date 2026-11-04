import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';

const count = z.number().int().min(0);
const counts = z.array(z.strictObject({ operation: z.string(), count }));

export const activitySummarySchema = z.strictObject({
  /** Journal cursor up to which commands were counted. */
  cursor: count,
  /** Committed commands per operation, most frequent first. */
  operations: counts,
  /** Modules whose commands are counted, from the launcher setting. */
  modules: z.array(z.string()),
});

export const activityOperations = {
  summaryGet: defineCapability({
    id: 'activity.summary.get',
    kind: 'query',
    description:
      'Read how many commands of each operation the workspace committed, counted from the journal, and the journal cursor reached. Use it to see which operations people and agents use.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(activitySummarySchema),
    permission: { action: 'read', resourceType: 'Activity' },
    ui: { binding: 'activity-summary' },
    display: { label: 'Activity' },
  }),
  passRecord: defineCapability({
    id: 'activity.pass.record',
    kind: 'command',
    description:
      'Add one counting pass to the activity summary: the journal cursor reached and the commands counted per operation. Called by the plugin counting loop as a delegated caller.',
    input: jsonSchema(z.strictObject({ cursor: count, counted: counts })),
    output: jsonSchema(activitySummarySchema.omit({ modules: true })),
    permission: { action: 'write', resourceType: 'Activity' },
    ui: {
      exception:
        'Written only by the counting loop, which runs as a delegated caller; people read the result through activity.summary.get.',
    },
    audit: { fields: ['cursor'] },
  }),
} as const;

/** Browser-safe module: the summary query and the counting loop's record command. */
export const activityModule = defineModule({
  id: 'activity',
  capabilities: Object.values(activityOperations),
});

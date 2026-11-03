import { z } from 'zod';
import { defineCapability, jsonSchema } from '@agent-native/contracts';

const assigneeSchema = z.strictObject({
  type: z.literal('person'),
  id: z.string().min(1).max(256),
  label: z.string().max(300),
});

/** Who can take a cycle count here: the attendants. */
export const assigneeList = defineCapability({
  id: 'assignee.list',
  kind: 'query',
  description: 'The attendants who can take a cycle count. Viewers only read counts.',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({ items: z.array(assigneeSchema) })),
  permission: { action: 'read', resourceType: 'ToolStore' },
  ui: { binding: 'assignee.list' },
});

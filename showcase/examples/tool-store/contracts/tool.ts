import { z } from 'zod';
import {
  collectionCreate,
  collectionGet,
  collectionList,
  collectionUpdate,
  defineCollection,
  recordKeySchema,
} from '@tortoise/contracts';

export const toolCategories = [
  'torque-tool',
  'crimper',
  'insulation-tester',
  'gauge',
  'hand-tool',
  'power-tool',
] as const;
export const toolStatuses = [
  'available',
  'checked-out',
  'in-repair',
  'missing',
  'retired',
] as const;

/** The etched asset tag: TC- followed by five digits. The counter's scan route uses it too. */
export const assetTagPattern = /^TC-\d{5}$/;

// #region record
/** What a caller sees of one tool. */
export const toolSchema = z.strictObject({
  id: recordKeySchema,
  assetTag: z
    .string()
    .regex(assetTagPattern)
    .describe('The tag etched into the tool: TC- followed by five digits, such as TC-00601.'),
  description: z
    .string()
    .min(1)
    .max(200)
    .describe('What the tool is, such as "Torque wrench 20-100 Nm".'),
  category: z.enum(toolCategories).describe('The kind of tool.'),
  bin: z.string().min(1).max(20).describe('The shelf bin that holds the tool, such as A-03.'),
  status: z
    .enum(toolStatuses)
    .describe('Where the tool stands: on the shelf, lent, in repair, missing or retired.'),
  calibrationDue: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('The date calibration is due, as YYYY-MM-DD. Only for tools that need calibration.'),
  createdBy: z.string(),
  createdAt: z.number().int().nonnegative(),
  revision: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'The revision of tool:<id>. `tool.get` and `tool.list` return it, so a screen can share the tools it shows with an agent run.',
    ),
});
// #endregion record
export type Tool = z.output<typeof toolSchema>;

export const tools = defineCollection({
  type: 'tool',
  resourceType: 'Tool',
  item: toolSchema,
  label: { one: 'Tool', many: 'Tools' },
  titleField: 'assetTag',
  fields: [
    { name: 'assetTag', label: 'Asset tag' },
    { name: 'description', label: 'Description' },
    { name: 'category', label: 'Category' },
    { name: 'bin', label: 'Bin' },
    { name: 'status', label: 'Status' },
    { name: 'calibrationDue', label: 'Calibration due' },
  ],
});

/** Reads and writes of tools. Browser-safe. */
export const toolOperations = {
  toolList: collectionList(tools, {
    id: 'tool',
    description:
      'List tools, newest first. Filter by status or category, or search the asset tag and description. Each tool has its revision. Read a tool with tool.get before changing it. Members.',
    filters: ['status', 'category'],
    search: true,
  }),
  toolGet: collectionGet(tools, {
    id: 'tool',
    description:
      'Read one tool by id, with its revision. Pass that revision as expectedRevisions {"tool:<id>": revision} to a command that changes the tool. The command is refused with CONFLICT when the tool changed since. The command receipt of a change to the tool has its new revision as tool:<id>. Members.',
  }),
  toolCreate: collectionCreate(tools, {
    id: 'tool',
    description:
      'Add a tool to the store as available. A second tool with the same asset tag is refused with CONFLICT. The tool is new, so there is no revision to pass. The command receipt has its first revision as tool:<id>. Attendants only. A viewer is refused with FORBIDDEN.',
    fields: ['assetTag', 'description', 'category', 'bin', 'calibrationDue'],
  }),
  toolUpdate: collectionUpdate(tools, {
    id: 'tool',
    description:
      'Change the description, category, bin or calibration date of a tool. A field left out keeps its value, so this command cannot clear a calibration date. The asset tag and status do not change here. Pass the revision tool.get returned as expectedRevisions {"tool:<id>": revision}. A stale revision is refused with CONFLICT and nothing changes. Attendants only. A viewer is refused with FORBIDDEN.',
    fields: ['description', 'category', 'bin', 'calibrationDue'],
  }),
} as const;

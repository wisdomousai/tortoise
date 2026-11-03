import { z } from 'zod';
import { defineAssignmentKind } from '@agent-native/assignments';
import { toolSchema } from './tool';

/**
 * The most tools one count covers. Accepting a report runs one tool command per tool it changes,
 * inside the accept's transaction, and the runtime allows 64 nested commands per command.
 */
export const maxCountedTools = 64;

const tags = z.array(toolSchema.shape.assetTag).max(maxCountedTools);

/**
 * Cycle count of one shelf bin. The brief lists the bin and the tools the store records there, by
 * asset tag with their status when the count was sent; retired tools are left out. One report
 * lists the tags found in the bin and the tags missing from it. Accepting the report sets each
 * missing tool to missing and each found tool that was missing back to available.
 */
// #region kind
export const cycleCount = defineAssignmentKind({
  id: 'cycle-count',
  title: 'Cycle count',
  description:
    'Count the tools in one shelf bin. Report the asset tags you found in the bin and the asset tags from the brief that are not there. Report as missing only tools expected on the shelf, those available or missing in the brief; a checked-out tool reported missing is refused on accept.',
  scope: z.strictObject({
    bin: toolSchema.shape.bin.describe('The shelf bin to count, such as A-03.'),
  }),
  brief: z.strictObject({
    bin: toolSchema.shape.bin,
    tools: z.array(
      z.strictObject({ assetTag: toolSchema.shape.assetTag, status: toolSchema.shape.status }),
    ),
  }),
  report: z.strictObject({
    found: tags.describe('The asset tags found in the bin.'),
    missing: tags.describe('The asset tags from the brief that are not in the bin.'),
  }),
  assigneeTypes: ['person'],
  invokes: ['tool.mark-missing', 'tool.mark-found'],
  changes: ['tool'],
});
// #endregion kind

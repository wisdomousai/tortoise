import { z } from 'zod';
import {
  defineCapability,
  jsonSchema,
  MAX_PAGE,
  type WorkflowDeclaration,
} from '@agent-native/contracts';
import { toolSchema } from './tool';

/** The days `tool.calibration-due` looks ahead when the caller leaves `days` out. */
export const DEFAULT_CALIBRATION_DAYS = 14;
/** The bin that holds the tools waiting for the calibration lab. */
export const calibrationBin = 'CAL-01';

/** List tools whose calibration falls due within a number of days, soonest first. Members. */
export const toolCalibrationDue = defineCapability({
  id: 'tool.calibration-due',
  kind: 'query',
  description: `List the tools that are not retired and whose calibration date is on or before today plus days, soonest first. It includes tools past their date and leaves out tools without a calibration date. Today is the UTC date of the instance clock, and the output's through is the last date included. The output's total counts every match, before paging. It returns no revision: read a tool with tool.get before changing it. Members.`,
  input: jsonSchema(
    z.strictObject({
      days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe(
          `How many days past today to include, 1 to 90; ${DEFAULT_CALIBRATION_DAYS} when left out.`,
        ),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Matching tools to skip before the page starts; 0 when left out.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE)
        .optional()
        .describe(
          `Most tools on the page, 1 to ${MAX_PAGE}. The output's total counts every match.`,
        ),
    }),
  ),
  output: jsonSchema(
    z.strictObject({
      items: z.array(toolSchema),
      total: z.number().int().min(0),
      through: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe('The last calibration date included, as YYYY-MM-DD: today plus days.'),
    }),
  ),
  permission: { action: 'read', resourceType: 'Tool' },
  dependencies: ['tool'],
  ui: {
    exception: 'agents pull tools for calibration over MCP and the CLI; no screen lists it yet',
  },
  display: {
    label: 'Calibration due',
    resource: 'tool',
    titleField: 'assetTag',
    fields: [
      { name: 'assetTag', label: 'Asset tag' },
      { name: 'description', label: 'Description' },
      { name: 'bin', label: 'Bin' },
      { name: 'status', label: 'Status' },
      { name: 'calibrationDue', label: 'Calibration due' },
    ],
  },
});

/**
 * Workflow text for an agent that moves the tools due for calibration to the calibration bin. It
 * names operation IDs; each surface shows them under its own tool names.
 */
// #region workflow
export const calibrationPull: WorkflowDeclaration = {
  id: 'calibration-pull',
  operations: ['tool.calibration-due', 'tool.get', 'tool.update'],
  text: `Move the tools due for calibration to bin ${calibrationBin}, where they wait for the calibration lab. Only an attendant can do this: tool.update refuses a viewer with FORBIDDEN.

1. Call tool.calibration-due. Leave days out for the default ${DEFAULT_CALIBRATION_DAYS} days unless the user names another number. Read every page: raise offset by the number of items until it reaches total.
2. For each tool in the list whose status is available and whose bin is not ${calibrationBin}, call tool.get with its id. If the tool is still available and not in ${calibrationBin}, call tool.update with that id and bin ${calibrationBin}, and pass expectedRevisions {"tool:<id>": <the revision tool.get just returned>}. Leave the other fields out, so they keep their values. Use a new idempotency key for each tool, and the same key only to repeat that call.
3. When tool.update refuses the call with CONFLICT, the tool changed after you read it. Call tool.get again and repeat step 2 for that tool once. When it conflicts again, leave the tool and name it in the answer.
4. Leave every other tool where it is. Do not move a tool that is checked-out, in-repair or missing, and call no other command.

In the answer, list by asset tag the tools you moved to ${calibrationBin}, the tools already in ${calibrationBin}, and the checked-out tools you left where they are, each with its bin and calibration date. Name any tool in repair or missing, and any tool you could not move, with the reason.`,
};
// #endregion workflow

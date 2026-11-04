import { z } from 'zod';
import { defineCapability, jsonSchema, recordKeySchema } from '@tortoise/contracts';
import { toolSchema } from './tool';

/**
 * Take a tool out of service for good. Attendants only. The repair triage agent requests it for
 * approval, and an attendant approves on the Approvals screen.
 */
export const toolRetire = defineCapability({
  id: 'tool.retire',
  kind: 'command',
  description:
    'Retire a tool for good: set its status to retired. A checked-out tool is refused with CONFLICT until it is returned, and so is a tool that is already retired. Nothing is sent to the EAM. Pass the revision tool.get returned as expectedRevisions {"tool:<toolId>": revision}. A stale revision is refused with CONFLICT and nothing changes. Attendants only. A viewer is refused with FORBIDDEN.',
  input: jsonSchema(
    z.strictObject({
      toolId: recordKeySchema.describe('The key of the tool to retire.'),
    }),
  ),
  output: jsonSchema(toolSchema),
  permission: { action: 'write', resourceType: 'Tool' },
  dependencies: ['tool'],
  // An attendant runs it by approving a request on the Approvals screen.
  ui: { binding: 'tool.retire' },
  display: {
    label: 'Retire',
    resource: 'tool',
    titleField: 'assetTag',
    fields: [
      { name: 'assetTag', label: 'Asset tag' },
      { name: 'status', label: 'Status' },
    ],
  },
  audit: { fields: ['toolId'] },
});

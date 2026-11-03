import { z } from 'zod';
import { defineCapability, jsonSchema, recordKeySchema } from '@agent-native/contracts';
import { toolSchema } from './tool';

const display = (label: string) => ({
  label,
  resource: 'tool',
  titleField: 'assetTag',
  fields: [
    { name: 'assetTag', label: 'Asset tag' },
    { name: 'status', label: 'Status' },
  ],
});

/** Record that an available tool is not in its bin. Attendants only. */
export const toolMarkMissing = defineCapability({
  id: 'tool.mark-missing',
  kind: 'command',
  description:
    'Record that an available tool is not in its bin: set its status to missing. A tool that is not available is refused with CONFLICT: a checked-out tool has an open loan, a tool in repair or retired is not expected on the shelf, and a missing one is missing already. Pass the revision tool.get returned as expectedRevisions {"tool:<toolId>": revision}. A stale revision is refused with CONFLICT and nothing changes. Attendants only. A viewer is refused with FORBIDDEN.',
  input: jsonSchema(
    z.strictObject({ toolId: recordKeySchema.describe('The key of the tool that is missing.') }),
  ),
  output: jsonSchema(toolSchema),
  permission: { action: 'write', resourceType: 'Tool' },
  dependencies: ['tool'],
  ui: { exception: 'an attendant runs it by accepting a cycle count report' },
  display: display('Mark missing'),
  audit: { fields: ['toolId'] },
});

/** Record that a missing tool is back in its bin. Attendants only. */
export const toolMarkFound = defineCapability({
  id: 'tool.mark-found',
  kind: 'command',
  description:
    'Record that a missing tool is back in its bin: set its status to available. A tool that is not missing is refused with CONFLICT. Pass the revision tool.get returned as expectedRevisions {"tool:<toolId>": revision}. A stale revision is refused with CONFLICT and nothing changes. Attendants only. A viewer is refused with FORBIDDEN.',
  input: jsonSchema(
    z.strictObject({ toolId: recordKeySchema.describe('The key of the tool that was found.') }),
  ),
  output: jsonSchema(toolSchema),
  permission: { action: 'write', resourceType: 'Tool' },
  dependencies: ['tool'],
  ui: { exception: 'an attendant runs it by accepting a cycle count report' },
  display: display('Mark found'),
  audit: { fields: ['toolId'] },
});

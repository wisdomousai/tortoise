import { definePeerApi } from '@tortoise/contracts';
import { assignments } from './kinds';

/**
 * What a paired field device calls on the hub, as its device principal: the survey inbound sync, a
 * report per capture and the done mark. Browser-safe; the field application's worklist declares
 * the hub as a target through it, and device link grants a device exactly these.
 */
export const hubApi = definePeerApi({
  application: 'asset-survey',
  commands: assignments.assignees.device.commands,
  queries: assignments.assignees.device.queries,
});

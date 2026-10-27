import { definePeerSurface } from '@agent-native/contracts';
import { assignments } from './kinds';

/**
 * What a paired field device calls on the hub, as its device principal: the survey feed, a
 * report per capture and the done mark. Browser-safe; the field application's worklist declares
 * the hub as a target through it, and device link grants a device exactly these.
 */
export const hubSurface = definePeerSurface({
  application: 'asset-survey',
  commands: assignments.lanes.device.commands,
  queries: assignments.lanes.device.queries,
});

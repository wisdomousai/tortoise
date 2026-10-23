import { definePeerSurface } from '@agent-native/contracts';
import { fieldOperations } from './captures';

/**
 * What a paired field device may call on the hub, as its device principal: read the assignments
 * dispatched to it, hand over captures and return its work. Browser-safe; the field application
 * declares the hub as a target through it, and the hub's device lane grants exactly these.
 */
export const fieldSurface = definePeerSurface({
  application: 'asset-survey',
  commands: [fieldOperations.captureIngest, fieldOperations.assignmentReturn],
  queries: [fieldOperations.assignmentFeed],
});

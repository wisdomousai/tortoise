import { defineWorklist } from '@agent-native/assignments';
import {
  assignments,
  notesAssignmentsSurface,
} from '@agent-native/sample-notes-assignments/contracts';

/**
 * The note reviews notes-assignments sends this application over the peer link, and the reports
 * recorded here for them. Operations are `worklist.*`; the target is `reviews`, reached through
 * the `reviews-peer` destination the site policy binds.
 */
export const worklist = defineWorklist({
  namespace: 'worklist',
  target: 'reviews',
  assignments,
  issuer: notesAssignmentsSurface,
  lane: 'peer',
  destination: {
    id: 'reviews-peer',
    purpose: 'Take note reviews from notes-assignments and send back the reports on them.',
    dataClasses: ['note'],
    availability: 'optional',
    offline: 'queue',
  },
});

/** The worklist's operations, flat, so screens bind them by name. */
export const worklistOperations = worklist.operations;
export { review } from '@agent-native/sample-notes-assignments/contracts';

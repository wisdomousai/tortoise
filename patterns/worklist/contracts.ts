import { defineWorklist } from '@agent-native/assignments';
import { assignments, samplingSurface } from '@agent-native/pattern-assignments/contracts';

/**
 * The sampling rounds the oil lab sends this application over the peer link, and the samples
 * recorded here for them. Operations are `worklist.*`; the target is `lab`, reached through the
 * `lab-peer` destination the site policy binds.
 */
export const worklist = defineWorklist({
  namespace: 'worklist',
  target: 'lab',
  assignments,
  issuer: samplingSurface,
  lane: 'peer',
  destination: {
    id: 'lab-peer',
    purpose: 'Take sampling rounds from the oil lab and send back the samples drawn on them.',
    dataClasses: ['test-request'],
    availability: 'optional',
    offline: 'queue',
  },
});

/** The worklist's operations, flat, so screens bind them by name. */
export const worklistOperations = worklist.operations;
export { sampling } from '@agent-native/pattern-assignments/contracts';

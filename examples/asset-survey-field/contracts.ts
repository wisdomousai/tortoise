import { defineWorklist } from '@agent-native/assignments';
import { assignments, survey } from '@agent-native/asset-survey/contracts/kinds';
import { hubSurface } from '@agent-native/asset-survey/contracts/peer';

/**
 * The surveys the hub sends this device, and the captures recorded here for them. Operations are
 * `field.*`. A capture or a done mark goes out through the outbox to the hub's own
 * `assignment.survey.report` or `assignment.complete`, and the hub's `assignment.feed` brings the
 * surveys open for this device with their structure slices. Hub-link declares the `hub`
 * destination and carries the device credential, so the manifest lists no peer component.
 */
export const worklist = defineWorklist({
  namespace: 'field',
  target: 'hub',
  assignments,
  issuer: hubSurface,
  lane: 'device',
  destination: {
    id: 'hub',
    purpose: 'Deliver captures and their photos to the hub, and read the surveys sent here.',
    dataClasses: ['field-record', 'photo'],
    availability: 'optional',
    offline: 'queue',
  },
});

/** The worklist's operations, flat, so screens bind them by name. */
export const fieldOperations = worklist.operations;
export const fieldModule = worklist.module;
export { survey };

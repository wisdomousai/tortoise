import { z } from 'zod';
import { defineWorklist, WORKLIST_ASSIGNMENT } from '@tortoise/assignments';
import { defineModule, effectOutcomeSchema, recordKeySchema } from '@tortoise/contracts';
import { assignments, survey } from '@tortoise/asset-survey/contracts/kinds';
import { operation } from '@tortoise/asset-survey/contracts/operation';
import { hubApi } from '@tortoise/asset-survey/contracts/peer';
import { fieldOs } from './os';

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
  issuer: hubApi,
  assigneeType: 'device',
  destination: {
    id: 'hub',
    purpose: 'Deliver captures and their photos to the hub, and read the surveys sent here.',
    dataClasses: ['field-record', 'photo'],
    availability: 'optional',
    offline: 'queue',
  },
});

/** The worklist's operations and the two the OS declarations need, flat, so screens bind them by name. */
export const fieldOperations = {
  ...worklist.operations,
  tagGet: operation('field.tag.get', 'query', {
    input: z.strictObject({ id: z.string().regex(/^[^\s:]{1,128}$/) }),
    output: z.strictObject({
      id: z.string(),
      matches: z.array(
        z.strictObject({
          assignmentId: recordKeySchema,
          nodeId: recordKeySchema,
          designation: z.string(),
          name: z.string(),
        }),
      ),
    }),
    permission: { action: 'read', resourceType: WORKLIST_ASSIGNMENT },
    description:
      'Where an asset tag is in the open surveys: the nodes it finds as a scan does, by designation prefix with spaces and case ignored, or by name. An intent from another app opens tag:<tag> through this query.',
    dependencies: [worklist.types.assignment],
    exception:
      'Read when an OS request opens tag:<tag>, to choose the capture or search screen that shows it.',
  }),
  noticesComplete: operation('assignment-notices.effect.complete', 'command', {
    input: z.strictObject({
      effectId: z.string().min(1).max(128),
      outcome: effectOutcomeSchema,
      fence: z.number().int().min(1).optional(),
    }),
    output: z.strictObject({}),
    permission: { action: 'complete', resourceType: 'AssignmentNotice' },
    description:
      'Notification dispatcher only: record whether the device showed the notice of a new survey.',
    dependencies: [worklist.types.assignment],
    exception: 'Called by the notification dispatcher once the device showed the notice.',
  }),
};

export const fieldModule = defineModule({
  ...worklist.module,
  capabilities: [
    ...worklist.module.capabilities,
    fieldOperations.tagGet,
    fieldOperations.noticesComplete,
  ],
  os: fieldOs,
});
export { survey };

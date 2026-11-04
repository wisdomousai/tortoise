import { z } from 'zod';
import { jsonSchema, type OsDeclarations } from '@tortoise/contracts';

/** The intent action an RFID reader or the plant's maintenance app sends with a tag it read. */
export const findTagAction = 'dev.agentnative.survey.action.FIND_TAG';

/**
 * How the OS reaches the field app, and what the app asks of it:
 *
 * - Another Android app that read an asset tag sends it as an intent, and the app opens the
 *   node that carries it, as a scan does.
 * - From a capture, a work request for the node goes to the maintenance app as an explicit
 *   intent, so no other app that declares the same action receives it.
 * - A capture's summary goes to the share sheet as text.
 * - A notification tells the owner about each assignment the hub sends to the device.
 *
 * None of them commits: the intent only opens a screen, and the maintenance app decides itself
 * what to do with a request.
 */
export const fieldOs: OsDeclarations = {
  handlers: [
    {
      id: 'node.from-tag',
      kind: 'intent',
      description:
        'Open the node of an open assignment whose designation is the tag another app read.',
      action: findTagAction,
      extras: jsonSchema(
        z.strictObject({
          tag: z
            .string()
            .regex(/^[^\s:]{1,128}$/)
            .describe('A designation as printed on the tag, such as =G1-Q1.'),
        }),
      ),
      target: { open: 'tag', id: '{tag}' },
    },
  ],
  actions: [
    {
      id: 'node.work-request',
      kind: 'intent',
      description: 'Ask the maintenance app to raise a work request for a node.',
      action: 'com.example.maintenance.action.CREATE_WORK_REQUEST',
      package: 'com.example.maintenance',
      extras: jsonSchema(
        z.strictObject({
          designation: z.string().min(1).max(128),
          name: z.string().max(200),
          note: z.string().max(1000),
        }),
      ),
      dataClasses: ['field-record'],
    },
    {
      id: 'capture.share',
      kind: 'share',
      description: 'Share the summary of a capture as text.',
      accepts: { text: true },
      dataClasses: ['field-record'],
    },
    {
      id: 'assignment.notice',
      kind: 'notify',
      description: 'Announce an assignment the hub sent to this device.',
      dataClasses: ['assignment-title'],
      categories: [{ id: 'assignment-new', actions: [] }],
      // The hub's feed queues these; one waits until the app comes to the foreground.
      targets: ['assignment-notices'],
      offline: 'queue',
    },
  ],
};

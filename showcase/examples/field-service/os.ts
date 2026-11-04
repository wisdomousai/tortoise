import { z } from 'zod';
import { jsonSchema, type OsDeclarations } from '@tortoise/contracts';
import { attachmentLimits } from './attachments';

const id = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/)
  .describe('A work order or task ID as it appears in a link.');

/**
 * How the OS reaches field-service: links to a task or a work order open its screen, a text or
 * Markdown file opened with the application prefills a new task, and an image or PDF prefills
 * one with the file attached. Text, a link or an image or PDF shared from another app prefills
 * a task the same way. A reminder shows as a notification on the desktop or phone, and its Mark
 * done action sets the task to done. A launcher entry (the dock menu, the jump list, an Android
 * app shortcut, the installed web app's shortcuts) starts a new task. A work order's site opens
 * on a map in the browser, and its summary goes to the share sheet. Content declares paths only;
 * the scheme comes from the application identity, so these links read
 * `<scheme>://tasks/<id>`. Nothing unsolicited commits: a prefilled task is created only when
 * the person adds it, and only the reply to a reminder this application showed sets a status.
 */
export const fieldServiceOs: OsDeclarations = {
  handlers: [
    {
      id: 'task.open',
      kind: 'link',
      description: 'Open the work order that holds a task.',
      path: '/tasks/:taskId',
      params: jsonSchema(z.strictObject({ taskId: id })),
      target: { open: 'task', id: '{taskId}' },
    },
    {
      id: 'work-order.open',
      kind: 'link',
      description: 'Open a work order.',
      path: '/work-orders/:workOrderId',
      params: jsonSchema(z.strictObject({ workOrderId: id })),
      target: { open: 'work-order', id: '{workOrderId}' },
    },
    {
      id: 'task.from-text',
      kind: 'file',
      description: 'Prefill a new task from a text or Markdown file: its name and its text.',
      types: [
        { extensions: ['txt'], mediaTypes: ['text/plain'], description: 'Plain text' },
        { extensions: ['md', 'markdown'], mediaTypes: ['text/markdown'], description: 'Markdown' },
      ],
      role: 'viewer',
      payload: 'text',
      // The task description holds at most 10,000 characters.
      maxBytes: 10_000,
      target: {
        prepare: 'task.create',
        input: { title: '{file.stem}', description: '{file.text}' },
      },
    },
    {
      id: 'task.from-attachment',
      kind: 'file',
      description: 'Prefill a new task from an image or PDF: its name, with the file attached.',
      types: [
        { extensions: ['png'], mediaTypes: ['image/png'], description: 'PNG image' },
        { extensions: ['jpg', 'jpeg'], mediaTypes: ['image/jpeg'], description: 'JPEG image' },
        { extensions: ['pdf'], mediaTypes: ['application/pdf'], description: 'PDF document' },
      ],
      role: 'viewer',
      payload: 'blob',
      // The shell uploads the file before submitting it; task.create attaches at most this.
      maxBytes: attachmentLimits.maxBytes,
      target: {
        prepare: 'task.create',
        input: { title: '{file.stem}', attachment: '{file.blob}' },
      },
    },
    {
      id: 'task.from-shared-link',
      kind: 'share',
      description: 'Prefill a new task whose description is a link shared from another app.',
      accepts: { url: true },
      maxBytes: 2048,
      target: { prepare: 'task.create', input: { description: '{url}' } },
    },
    {
      id: 'task.from-shared-file',
      kind: 'share',
      description: 'Prefill a new task from an image or PDF shared from another app, attached.',
      accepts: { mediaTypes: [...attachmentLimits.mediaTypes] },
      maxBytes: attachmentLimits.maxBytes,
      // The share carries the file name as its title on the web and on a device.
      target: { prepare: 'task.create', input: { title: '{title}', attachment: '{blob}' } },
    },
    {
      id: 'task.from-shared-text',
      kind: 'share',
      description: 'Prefill a new task whose description is text shared from another app.',
      accepts: { text: true },
      maxBytes: 10_000,
      target: { prepare: 'task.create', input: { description: '{text}' } },
    },
    {
      id: 'task.new',
      kind: 'shortcut',
      description: 'Start a new task from the launcher.',
      title: 'New task',
      target: { prepare: 'task.create', input: {} },
    },
    {
      id: 'task.reminder-reply',
      kind: 'reply',
      description: 'A choice made on a task reminder, redeemed by the notifications plugin.',
      consumer: 'notifications',
    },
  ],
  actions: [
    {
      id: 'work-order.site-map',
      kind: 'open',
      description: 'Show the site address of a work order on OpenStreetMap.',
      url: 'https://www.openstreetmap.org/search',
      params: jsonSchema(
        z.strictObject({
          query: z.string().min(1).max(200).describe('The site address to search for.'),
        }),
      ),
      dataClasses: ['site-address'],
    },
    {
      id: 'work-order.share',
      kind: 'share',
      description: 'Share the summary of a work order as text: its name, site and open tasks.',
      accepts: { text: true },
      dataClasses: ['site-address', 'task-title'],
    },
    {
      id: 'task.reminder',
      kind: 'notify',
      description: 'Show a task reminder with a Mark done action.',
      dataClasses: ['task-title'],
      categories: [
        {
          id: 'task-reminder',
          actions: [{ id: 'done', title: 'Mark done', reply: 'task.reminder-reply' }],
        },
      ],
      // task.remind queues these; a reminder waits until a desktop or phone shows it.
      targets: ['task-reminders'],
      offline: 'queue',
    },
  ],
};

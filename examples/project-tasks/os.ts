import { z } from 'zod';
import { jsonSchema, type OsDeclarations } from '@agent-native/contracts';
import { attachmentLimits } from './attachments';

const id = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/)
  .describe('A project or task ID as it appears in a link.');

/**
 * How the OS reaches project-tasks: links to a task or a project open its screen, a text or
 * Markdown file opened with the application prefills a new task, and an image or PDF prefills
 * one with the file attached. Text, a link or an image or PDF shared from another app prefills
 * a task the same way. Content declares paths only;
 * the scheme comes from the application identity, so these links read
 * `<scheme>://tasks/<id>`. Nothing here commits: a prefilled task is created only when the
 * person adds it.
 */
export const projectTasksOs: OsDeclarations = {
  handlers: [
    {
      id: 'task.open',
      kind: 'link',
      description: 'Open the project that holds a task.',
      path: '/tasks/:taskId',
      params: jsonSchema(z.strictObject({ taskId: id })),
      target: { open: 'task', id: '{taskId}' },
    },
    {
      id: 'project.open',
      kind: 'link',
      description: 'Open a project.',
      path: '/projects/:projectId',
      params: jsonSchema(z.strictObject({ projectId: id })),
      target: { open: 'project', id: '{projectId}' },
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
  ],
};

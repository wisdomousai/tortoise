import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  buildCatalog,
  defineCapability,
  defineHostComponent,
  defineModule,
  jsonSchema,
  linkPathSegments,
  templatePlaceholders,
  type AnyCapability,
  type OsAction,
  type OsHandler,
} from '../src/index';

const create = defineCapability({
  id: 'task.create',
  kind: 'command',
  input: jsonSchema(z.strictObject({ projectId: z.string(), title: z.string() })),
  output: jsonSchema(z.string()),
  permission: { action: 'create', resourceType: 'task' },
  ui: { binding: 'task.create' },
});
const headless = defineCapability({
  ...create,
  id: 'task.import',
  ui: { exception: 'fixture' },
});
const taskParams = jsonSchema(z.strictObject({ taskId: z.string() }));
const link: OsHandler = {
  id: 'task.open',
  kind: 'link',
  description: 'Open a task.',
  path: '/tasks/:taskId',
  params: taskParams,
  target: { open: 'task', id: '{taskId}' },
};
const textFile: OsHandler = {
  id: 'task.from-file',
  kind: 'file',
  description: 'Create a task from a note.',
  types: [{ extensions: ['txt'], mediaTypes: ['text/plain'], description: 'Note' }],
  role: 'viewer',
  payload: 'text',
  maxBytes: 65536,
  target: { prepare: 'task.create', input: { title: '{file.stem}' } },
};
const catalogOf = (handlers: OsHandler[], actions: OsAction[] = []) =>
  buildCatalog([
    defineModule({ id: 'tasks', capabilities: [create, headless], os: { handlers, actions } }),
  ]);

describe('OS declarations', () => {
  test('the catalog lists handlers and actions with JSON schemas and owners', () => {
    const catalog = catalogOf([link, textFile]);
    expect(catalog.os?.handlers.map((h) => h.id)).toEqual(['task.from-file', 'task.open']);
    const open = catalog.os?.handlers.find((h) => h.id === 'task.open');
    expect(open?.owner).toBe('tasks');
    expect(open && 'params' in open ? open.params?.type : undefined).toBe('object');
    expect(JSON.stringify(catalog)).not.toContain('"parse"');
  });

  test('a catalog without declarations has no os section', () => {
    expect(catalogOf([]).os).toBeUndefined();
  });

  test('host components declare OS actions', () => {
    const component = defineHostComponent({
      id: 'provider-sign-in',
      description: 'Opens the sign-in page.',
      requirements: {},
      os: {
        actions: [
          {
            id: 'provider.authorize',
            kind: 'open',
            description: 'Sign in in the system browser.',
            url: 'https://auth.example.com/authorize',
            params: jsonSchema(z.strictObject({ state: z.string() })),
            dataClasses: ['oauth-request'],
          },
        ],
      },
    });
    const catalog = buildCatalog([], { components: [component] });
    expect(catalog.os?.actions[0]?.owner).toBe('provider-sign-in');
  });

  test.each([
    [{ ...link, path: '/tasks/:other' }, 'has no schema for :other'],
    [{ ...link, target: { open: 'task', id: '{missing}' } }, 'unknown field {missing}'],
    [{ ...link, path: '/tasks/../x' }, 'Invalid link path segment'],
    [{ ...textFile, target: { prepare: 'task.import', input: {} } }, 'not a command with a UI'],
    [
      { ...textFile, target: { prepare: 'task.create', input: { owner: '{file.stem}' } } },
      'not an input field',
    ],
    [{ ...textFile, maxBytes: 2 * 1024 * 1024 }, 'maxBytes between'],
    [
      {
        ...textFile,
        types: [{ extensions: ['.txt'], mediaTypes: ['text/plain'], description: 'Note' }],
      },
      'extension',
    ],
  ] as [OsHandler, string][])('refuses %#: %s', (handler, message) => {
    expect(() => catalogOf([handler])).toThrow(message);
  });

  test('two handlers cannot claim one path shape, extension or id', () => {
    expect(() =>
      catalogOf([link, { ...link, id: 'task.alt', path: '/tasks/:taskId', target: link.target }]),
    ).toThrow('twice');
    expect(() => catalogOf([textFile, { ...textFile, id: 'other' }])).toThrow('twice');
    expect(() => catalogOf([link, link])).toThrow('Duplicate OS handler');
  });

  test.each([
    ['javascript:alert(1)', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['https://{host}/x', 'fix its host'],
    ['https://example.com/x?y=1', 'query'],
    ['https://user@example.com/x', 'credentials'],
    ['https://example.com/{page}', 'unknown parameter'],
  ])('refuses open URL %s', (url, message) => {
    const action: OsAction = {
      id: 'docs.open',
      kind: 'open',
      description: 'Open docs.',
      url,
      dataClasses: ['docs-link'],
    };
    expect(() => catalogOf([], [action])).toThrow(message);
  });

  test('notify actions reply only through declared reply handlers and may carry outbox targets', () => {
    const notify: OsAction = {
      id: 'task.notify',
      kind: 'notify',
      description: 'Tell the assignee.',
      categories: [
        { id: 'assigned', actions: [{ id: 'done', title: 'Done', reply: 'task.reply' }] },
      ],
      targets: ['notifications'],
      offline: 'queue',
      dataClasses: ['task-title'],
    };
    expect(() => catalogOf([], [notify])).toThrow('undeclared reply handler');
    const reply: OsHandler = {
      id: 'task.reply',
      kind: 'reply',
      description: 'Notification answers.',
      consumer: 'notifications',
    };
    const notifying = defineCapability({
      ...create,
      id: 'task.assign',
      integration: { target: 'notifications', delivery: 'outbox' },
    });
    const module = (capabilities: AnyCapability[]) =>
      defineModule({ id: 'tasks', capabilities, os: { handlers: [reply], actions: [notify] } });
    // The plugin settles each notification with the carried target's own settle command.
    expect(() => buildCatalog([module([create, notifying])])).toThrow(
      'carries notifications, which has no notifications.effect.settle command',
    );
    const settle = defineCapability({ ...create, id: 'notifications.effect.settle' });
    const catalog = buildCatalog([module([create, notifying, settle])]);
    expect(catalog.operations.find((o) => o.id === 'task.assign')?.destinations).toBeUndefined();
    expect(() => catalogOf([reply], [{ ...notify, offline: 'drop' } as OsAction])).toThrow('queue');
  });

  test('intent actions name their package, and extras are flat values', () => {
    const intent = {
      id: 'task.print',
      kind: 'intent',
      description: 'Print a task.',
      action: 'com.example.print.action.PRINT',
      package: 'com.example.print',
      extras: jsonSchema(z.strictObject({ copies: z.number().int() })),
      dataClasses: ['task-title'],
    } as OsAction;
    expect(catalogOf([], [intent]).os?.actions[0]?.id).toBe('task.print');
    expect(() => catalogOf([], [{ ...intent, package: '' } as OsAction])).toThrow(
      'must name the package it starts',
    );
    const nested = jsonSchema(z.strictObject({ page: z.strictObject({ n: z.number() }) }));
    expect(() => catalogOf([], [{ ...intent, extras: nested } as OsAction])).toThrow(
      'extra page, which is not a string, number or boolean',
    );
    const handler: OsHandler = {
      id: 'task.from-intent',
      kind: 'intent',
      description: 'A task another app asks for.',
      action: 'dev.example.tasks.action.CREATE',
      extras: nested,
      target: { prepare: 'task.create', input: {} },
    };
    expect(() => catalogOf([handler])).toThrow('extra page');
  });

  test('template and path syntax', () => {
    expect(templatePlaceholders('task:{taskId}')).toEqual(['taskId']);
    expect(() => templatePlaceholders('{a')).toThrow('Malformed');
    expect(linkPathSegments('/projects/:id/tasks')).toEqual([
      { literal: 'projects' },
      { param: 'id' },
      { literal: 'tasks' },
    ]);
    expect(() => linkPathSegments('/a/:id/:id')).toThrow('Repeated');
  });
});

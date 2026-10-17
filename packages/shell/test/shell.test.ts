import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  buildCatalog,
  defineCapability,
  defineModule,
  jsonSchema,
  type OsAction,
  type OsHandler,
} from '@agent-native/contracts';
import {
  buildInstruction,
  desktopOsConfig,
  matchOsRequest,
  nativeOsConfig,
  openUrl,
  parseRawOsRequest,
  resolveTarget,
  webManifestOs,
  webScheme,
} from '../src/index';

const create = defineCapability({
  id: 'task.create',
  kind: 'command',
  input: jsonSchema(
    z.strictObject({
      projectId: z.string(),
      title: z.string().max(80),
      notes: z.string().optional(),
      estimate: z.number().optional(),
    }),
  ),
  output: jsonSchema(z.string()),
  permission: { action: 'create', resourceType: 'task' },
  ui: { binding: 'task.create' },
});
const link: OsHandler = {
  id: 'task.open',
  kind: 'link',
  description: 'Open a task.',
  path: '/tasks/:taskId',
  params: jsonSchema(z.strictObject({ taskId: z.string().regex(/^[a-z0-9-]{1,64}$/) })),
  verified: true,
  target: { open: 'task', id: '{taskId}' },
};
const note: OsHandler = {
  id: 'task.from-note',
  kind: 'file',
  description: 'Create a task from a note.',
  types: [
    { extensions: ['txt', 'md'], mediaTypes: ['text/plain', 'text/markdown'], description: 'Note' },
  ],
  role: 'viewer',
  payload: 'text',
  maxBytes: 64,
  target: { prepare: 'task.create', input: { title: '{file.stem}', notes: '{file.text}' } },
};
const handlers = [link, note];
const catalog = buildCatalog([
  defineModule({ id: 'tasks', capabilities: [create], os: { handlers } }),
]);
const options = {
  schemes: ['dev.example.tasks', webScheme('dev.example.tasks')],
  linkHosts: ['tasks.example.com'],
};
const match = (value: unknown) => matchOsRequest(handlers, parseRawOsRequest(value), options);

describe('OS requests', () => {
  test('a scheme link and a verified https link open the task', () => {
    for (const url of [
      'dev.example.tasks://tasks/t-1',
      'dev.example.tasks:///tasks/t-1/',
      'https://tasks.example.com/tasks/t-1',
      'web+devexampletasks://tasks/t-1',
    ]) {
      const found = match({ kind: 'url', url })!;
      expect(resolveTarget(found, catalog)).toEqual({
        delivery: {
          type: 'openResource',
          resource: 'task:t-1',
          provenance: {
            kind: 'link',
            handler: 'task.open',
            ...(url.startsWith('https') ? { label: 'tasks.example.com' } : {}),
          },
        },
      });
    }
  });

  test('links that are not the application’s own, or are malformed, never match a handler', () => {
    expect(match({ kind: 'url', url: 'https://evil.example/tasks/t-1' })).toBeUndefined();
    expect(match({ kind: 'url', url: 'other://tasks/t-1' })).toBeUndefined();
    expect(match({ kind: 'url', url: 'dev.example.tasks://projects/p-1' })).toBeUndefined();
    // The URL parser resolves dot segments, so `%2e%2e` leaves `/tasks`, which nothing declares.
    expect(match({ kind: 'url', url: 'dev.example.tasks://tasks/%2e%2e' })).toBeUndefined();
    for (const url of [
      'dev.example.tasks://tasks/T 1',
      'dev.example.tasks://tasks/t-1?extra=1',
      'dev.example.tasks://user:pw@tasks/t-1',
      'dev.example.tasks://tasks/a%2Fb',
      'not a url',
    ])
      expect(() => match({ kind: 'url', url })).toThrow();
    expect(() =>
      match({ kind: 'url', url: `dev.example.tasks://tasks/${'a'.repeat(3000)}` }),
    ).toThrow('too long');
  });

  test('an opened text file prepares a form with checked fields and never names a command itself', () => {
    const found = match({
      kind: 'file',
      name: 'Buy milk.txt',
      mediaType: 'text/plain',
      text: 'two litres',
    })!;
    expect(resolveTarget(found, catalog)).toEqual({
      delivery: {
        type: 'prepare',
        operation: 'task.create',
        input: { title: 'Buy milk', notes: 'two litres' },
        provenance: { kind: 'file', handler: 'task.from-note', label: 'Buy milk.txt' },
      },
    });
    expect(() => match({ kind: 'file', name: 'big.md', text: 'x'.repeat(65) })).toThrow('larger');
    expect(() =>
      resolveTarget(match({ kind: 'file', name: `${'t'.repeat(81)}.md`, text: '' })!, catalog),
    ).toThrow('does not fit');
    expect(match({ kind: 'file', name: 'image.png', text: '' })).toBeUndefined();
    expect(() => parseRawOsRequest({ kind: 'file', name: '../etc/passwd', text: '' })).toThrow(
      'one path segment',
    );
    expect(() =>
      parseRawOsRequest({ kind: 'file', name: `a${String.fromCharCode(0x202e)}txt.exe`, text: '' }),
    ).toThrow('control');
    expect(() => parseRawOsRequest({ kind: 'url', url: 'x', principal: 'admin' })).toThrow(
      'Unknown field',
    );
  });
});

describe('OS actions', () => {
  const docs: OsAction = {
    id: 'docs.open',
    kind: 'open',
    description: 'Open a guide.',
    url: 'https://docs.example.com/guides/{page}',
    params: jsonSchema(z.strictObject({ page: z.string(), section: z.string().optional() })),
    dataClasses: ['docs-link'],
  };
  test('an open URL keeps its scheme, host and segments whatever the parameters hold', () => {
    expect(buildInstruction(docs, { page: 'setup', section: 'a b' }, () => undefined)).toEqual({
      kind: 'open',
      action: 'docs.open',
      url: 'https://docs.example.com/guides/setup?section=a+b',
    });
    expect(openUrl(docs.url, { page: '../../@evil.example/x?y#z' })).toBe(
      'https://docs.example.com/guides/..%2F..%2F%40evil.example%2Fx%3Fy%23z',
    );
    expect(() => buildInstruction(docs, { page: 'x', other: 'y' }, () => undefined)).toThrow(
      'do not fit',
    );
  });

  test('files are reached only below the configured root', () => {
    const reveal: OsAction = {
      id: 'export.reveal',
      kind: 'reveal',
      description: 'Show an export.',
      root: 'exports',
      dataClasses: [],
    };
    const roots = (key: string) => (key === 'exports' ? '/data/exports/' : undefined);
    expect(buildInstruction(reveal, { path: 'a/b.csv' }, roots)).toEqual({
      kind: 'reveal',
      action: 'export.reveal',
      path: '/data/exports/a/b.csv',
    });
    for (const path of ['../x', '/etc/passwd', 'a//b', 'a\\b'])
      expect(() => buildInstruction(reveal, { path }, roots)).toThrow();
    expect(() => buildInstruction(reveal, { path: 'a' }, () => undefined)).toThrow('no root');
  });
});

describe('registrations', () => {
  const identity = {
    appId: 'dev.example.tasks',
    scheme: 'dev.example.tasks',
    displayName: 'Tasks',
  };
  test('native, desktop and web registrations come from the same handlers', () => {
    const native = nativeOsConfig(catalog.os, identity, { linkHosts: ['tasks.example.com'] });
    expect(native.scheme).toBe('dev.example.tasks');
    expect(native.android.intentFilters).toContainEqual({
      action: 'VIEW',
      autoVerify: true,
      category: ['BROWSABLE', 'DEFAULT'],
      data: [{ scheme: 'https', host: 'tasks.example.com', pathPattern: '/tasks/.*' }],
    });
    expect(native.ios.associatedDomains).toEqual(['applinks:tasks.example.com']);
    expect(native.ios.infoPlist.CFBundleDocumentTypes).toEqual([
      {
        CFBundleTypeName: 'Note',
        CFBundleTypeRole: 'Viewer',
        LSHandlerRank: 'Alternate',
        LSItemContentTypes: ['public.plain-text'],
      },
    ]);
    expect(nativeOsConfig(catalog.os, identity).ios.associatedDomains).toEqual([]);
    expect(desktopOsConfig(catalog.os, identity)).toEqual({
      protocols: [{ name: 'Tasks', schemes: ['dev.example.tasks'] }],
      fileAssociations: [
        {
          ext: ['txt', 'md'],
          name: 'Note',
          description: 'Note',
          mimeType: 'text/plain',
          role: 'Viewer',
        },
      ],
    });
    expect(webManifestOs(catalog.os, identity)).toEqual({
      protocol_handlers: [{ protocol: 'web+devexampletasks', url: '/?os=%s' }],
      file_handlers: [
        {
          action: '/',
          accept: { 'text/plain': ['.txt', '.md'], 'text/markdown': ['.txt', '.md'] },
        },
      ],
    });
  });
});

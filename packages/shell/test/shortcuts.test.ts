import { expect, test } from 'bun:test';
import { z } from 'zod';
import {
  buildCatalog,
  defineCapability,
  defineModule,
  jsonSchema,
  type CatalogOs,
  type OsHandler,
} from '@tortoise/contracts';
import {
  createDesktopShell,
  launcherShortcuts,
  matchOsRequest,
  nativeOsConfig,
  parseRawOsRequest,
  shortcutIdOf,
  shortcutLink,
  webManifestOs,
} from '../src/index';

const scheme = 'dev.example.notes';
const create = defineCapability({
  id: 'note.create',
  kind: 'command',
  input: jsonSchema(z.strictObject({ title: z.string().optional() })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'create', resourceType: 'note' },
  ui: { binding: 'note.create' },
});
const handlers: OsHandler[] = [
  {
    id: 'note.new',
    kind: 'shortcut',
    description: 'A new note.',
    title: "Today's note",
    target: { prepare: 'note.create', input: {} },
  },
  {
    id: 'note.root',
    kind: 'link',
    description: 'The root link.',
    path: '/',
    params: jsonSchema(z.strictObject({ 'os-shortcut': z.string().optional() })),
    target: { screen: 'notes' },
  },
];
const os = buildCatalog([
  defineModule({ id: 'notes', capabilities: [create], os: { handlers } }),
]).os!;
const match = (url: string) =>
  matchOsRequest(handlers, parseRawOsRequest({ kind: 'url', url }), { schemes: [scheme] });

test('a shortcut link names one shortcut and nothing else', () => {
  const link = shortcutLink(scheme, 'note.new');
  expect(link).toBe('dev.example.notes:///?os-shortcut=note.new');
  expect(shortcutIdOf(link, [scheme])).toBe('note.new');
  for (const other of [
    `${link}&x=1`,
    `${link}#top`,
    `${scheme}://notes/?os-shortcut=note.new`,
    `${scheme}:///notes?os-shortcut=note.new`,
    `${scheme}:///?os-shortcut=Note New`,
    'other.app:///?os-shortcut=note.new',
    'not a url',
  ])
    expect(shortcutIdOf(other, [scheme])).toBeUndefined();
});

test('the shell port reads a shortcut link as its shortcut before matching links', () => {
  expect(match(shortcutLink(scheme, 'note.new'))?.handler.id).toBe('note.new');
  // An undeclared shortcut is not passed to a link handler on the root path either.
  expect(match(shortcutLink(scheme, 'note.gone'))).toBeUndefined();
  expect(match(`${scheme}:///`)?.handler.id).toBe('note.root');
});

test('launchers on every platform come from the same shortcut handlers', () => {
  const entries = launcherShortcuts(os, scheme);
  expect(entries).toEqual([
    { id: 'note.new', title: "Today's note", link: 'dev.example.notes:///?os-shortcut=note.new' },
  ]);
  expect(nativeOsConfig(os, { appId: 'dev.example.notes', scheme }).plugins).toContainEqual([
    '@tortoise/mobile/shortcuts',
    { shortcuts: entries },
  ]);
  expect(webManifestOs(os, { appId: 'dev.example.notes', scheme }).shortcuts).toEqual([
    { name: "Today's note", url: '/?os-shortcut=note.new' },
  ]);
});

test('the desktop shell registers launchers once it has the declarations', async () => {
  const registered: CatalogOs[] = [];
  const reports: string[] = [];
  const desktop = createDesktopShell({
    platform: 'macos',
    client: {
      declarations: async () => os,
      submit: async () => ({ status: 'delivered' }),
      perform: async () => undefined,
      next: async () => undefined,
      respond: async () => undefined,
      upload: async () => undefined,
    },
    readFile: async () => undefined,
    open: async () => undefined,
    reveal: async () => ({ ok: true }),
    openFile: async () => ({ ok: true }),
    launchers: (declarations) => {
      registered.push(declarations);
      throw new Error('no dock here');
    },
    focus: () => undefined,
    report: (message) => void reports.push(message),
  });
  await desktop.connect();
  expect(registered).toEqual([os]);
  // A launcher that fails to register leaves the shell connected.
  expect(reports).toEqual(['Launcher entries could not be registered']);
  desktop.close();
});

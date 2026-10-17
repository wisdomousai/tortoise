import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createFileBlobStore } from '@agent-native/adapters/blob-files';
import { bunSqlDriver } from '@agent-native/adapters/sqlite';
import {
  blobRefSchema,
  defineCapability,
  defineModule,
  jsonSchema,
  type OsDelivery,
} from '@agent-native/contracts';
import { defineApplication } from '@agent-native/kernel/application';
import { defineManifest } from '@agent-native/kernel/manifest';
import {
  connectMobileShell,
  createMobilePlatform,
  openMobileAuthority,
  type MobileAuthority,
  type MobileOsBindings,
} from '@agent-native/mobile';
import { createOsPlugin } from '../src/plugin';
import { osPluginManifest } from '../src/plugin-manifest';

// A fixture application on the phone: notes opened by link, created from a text file or a scan.
const scheme = 'dev.example.notes';
const noteGet = defineCapability({
  id: 'notes.get',
  kind: 'query',
  input: jsonSchema(z.strictObject({ id: z.string() })),
  output: jsonSchema(z.strictObject({ id: z.string(), revision: z.number() })),
  permission: { action: 'read', resourceType: 'Note' },
  ui: { exception: 'test fixture' },
});
const noteCreate = defineCapability({
  id: 'notes.create',
  kind: 'command',
  input: jsonSchema(
    z.strictObject({
      title: z.string().max(40),
      body: z.string().optional(),
      scan: blobRefSchema.optional(),
    }),
  ),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Note' },
  ui: { binding: 'notes.create' },
  blobs: { maxBytes: 64, mediaTypes: ['application/pdf'] },
});
const notes = defineModule({
  id: 'notes',
  capabilities: [noteGet, noteCreate],
  os: {
    handlers: [
      {
        id: 'note.open',
        kind: 'link',
        description: 'Open a note.',
        path: '/notes/:noteId',
        params: jsonSchema(z.strictObject({ noteId: z.string().regex(/^n-[0-9]+$/) })),
        target: { open: 'note', id: '{noteId}' },
      },
      {
        id: 'note.from-text',
        kind: 'file',
        description: 'A note from a text file.',
        types: [{ extensions: ['txt'], mediaTypes: ['text/plain'], description: 'Text' }],
        role: 'viewer',
        payload: 'text',
        maxBytes: 64,
        target: { prepare: 'notes.create', input: { title: '{file.stem}', body: '{file.text}' } },
      },
      {
        id: 'note.from-scan',
        kind: 'file',
        description: 'A note from a scanned page.',
        types: [{ extensions: ['pdf'], mediaTypes: ['application/pdf'], description: 'PDF' }],
        role: 'viewer',
        payload: 'blob',
        maxBytes: 64,
        target: { prepare: 'notes.create', input: { title: '{file.stem}', scan: '{file.blob}' } },
      },
    ],
    actions: [
      {
        id: 'notes.docs',
        kind: 'open',
        description: 'Open the notes guide.',
        url: 'https://docs.example.com/notes/{page}',
        params: jsonSchema(z.strictObject({ page: z.string() })),
        dataClasses: ['docs-link'],
      },
    ],
  },
});
const application = defineApplication<Record<string, never>>({
  manifest: defineManifest({
    id: 'notes',
    title: 'Notes',
    modules: [notes],
    plugins: [osPluginManifest],
    targets: ['mobile'],
  }),
  createState: () => ({}),
  handlers: [
    {
      capability: noteGet,
      handle: async (input: { id: string }) => {
        if (input.id === 'n-9') throw new Error('gone');
        return { id: input.id, revision: 1 };
      },
    },
    { capability: noteCreate, handle: async () => ({}) },
  ],
  authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
  selectableResources: { note: 'notes.get' },
  plugins: [createOsPlugin()],
});

const sandboxes: string[] = [];
const opened: MobileAuthority[] = [];
afterEach(async () => {
  for (const authority of opened.splice(0)) await authority.close();
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});
async function phone() {
  const sandbox = mkdtempSync(join(tmpdir(), 'os-mobile-'));
  sandboxes.push(sandbox);
  const authority = await openMobileAuthority(application, {
    platform: createMobilePlatform({
      id: 'android',
      openDatabase: (name) => bunSqlDriver(join(sandbox, name)),
      openBlobs: (workspace) => createFileBlobStore(join(sandbox, workspace, 'blobs')),
    }),
    settings: { 'os-scheme': scheme },
  });
  opened.push(authority);
  return authority;
}

/** The device's OS, faked: a launch link, later URIs, files by URI and opened URLs. */
function device(
  initial: string | null,
  files: Record<string, { name: string; type?: string; bytes: Uint8Array }>,
) {
  const listeners = new Set<(uri: string) => void>();
  const read: string[] = [];
  const openedUrls: string[] = [];
  const bindings: MobileOsBindings = {
    platform: 'android',
    scheme,
    initialUri: async () => initial,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    inspect: async (uri) => {
      const file = files[uri];
      return (
        file && {
          name: file.name,
          size: file.bytes.byteLength,
          ...(file.type ? { mediaType: file.type } : {}),
        }
      );
    },
    read: async (uri, maxBytes) => {
      read.push(uri);
      const file = files[uri];
      return file && file.bytes.byteLength <= maxBytes ? file.bytes : undefined;
    },
    open: async (url) => void openedUrls.push(url),
  };
  return {
    bindings,
    read,
    openedUrls,
    send: (uri: string) => listeners.forEach((listener) => listener(uri)),
  };
}

/** Time for requests that should show nothing to have been refused. */
const settle = () => Bun.sleep(20);
/** Wait until `condition` holds, polling; fails the test after two seconds. */
async function until(condition: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the device');
    await Bun.sleep(5);
  }
}
const text = (value: string) => new TextEncoder().encode(value);

test('a launch link waits for the frame, then later links and files are delivered', async () => {
  const authority = await phone();
  const fake = device(`${scheme}://notes/n-1`, {
    'content://media/42': { name: '42', type: 'text/plain', bytes: text('milk') },
    'content://media/43': { name: 'movie', type: 'video/mp4', bytes: new Uint8Array(4) },
  });
  const connection = connectMobileShell(authority, application, fake.bindings);
  await settle();
  const shown: OsDelivery[] = [];
  connection.deliveries.subscribe((delivery) => shown.push(delivery));
  await until(() => shown.length === 1);
  expect(shown).toEqual([
    {
      type: 'openResource',
      resource: 'note:n-1',
      provenance: { kind: 'link', handler: 'note.open' },
    },
  ]);

  // A text file from a content provider is matched by its media type, then read once.
  fake.send('content://media/42');
  // An undeclared type is never read; another app's scheme and an unreadable note show nothing.
  fake.send('content://media/43');
  fake.send('other.app://notes/n-1');
  fake.send(`${scheme}://notes/n-9`);
  await until(() => shown.length === 2);
  await settle();
  expect(fake.read).toEqual(['content://media/42']);
  expect(shown.slice(1)).toEqual([
    {
      type: 'prepare',
      operation: 'notes.create',
      input: { title: '42', body: 'milk' },
      provenance: { kind: 'file', handler: 'note.from-text', label: '42' },
    },
  ]);
  connection.close();
});

test('a scanned file is staged in the blob store and prefills the form as its reference', async () => {
  const authority = await phone();
  const fake = device(null, {
    'content://scans/7': { name: 'Receipt.pdf', type: 'application/pdf', bytes: text('%PDF-1') },
    'content://scans/8': { name: 'Big.pdf', type: 'application/pdf', bytes: new Uint8Array(65) },
  });
  const connection = connectMobileShell(authority, application, fake.bindings);
  const shown: OsDelivery[] = [];
  connection.deliveries.subscribe((delivery) => shown.push(delivery));
  fake.send('content://scans/7');
  fake.send('content://scans/8');
  await until(() => shown.length === 1);
  await settle();
  expect(fake.read).toEqual(['content://scans/7']);
  expect(shown).toHaveLength(1);
  const prepared = shown[0] as Extract<OsDelivery, { type: 'prepare' }>;
  expect(prepared.input).toMatchObject({
    title: 'Receipt',
    scan: { size: 6, mediaType: 'application/pdf' },
  });
  connection.close();
});

test('a declared open action runs through the device; without the plugin nothing attaches', async () => {
  const authority = await phone();
  const fake = device(null, {});
  const connection = connectMobileShell(authority, application, fake.bindings);
  expect(
    await authority.authority.ports.shell.perform(authority.context, {
      action: 'notes.docs',
      params: { page: 'start' },
    }),
  ).toEqual({ status: 'performed', action: 'notes.docs' });
  expect(fake.openedUrls).toEqual(['https://docs.example.com/notes/start']);
  connection.close();

  const sandbox = mkdtempSync(join(tmpdir(), 'os-mobile-'));
  sandboxes.push(sandbox);
  const plain = defineApplication<Record<string, never>>({
    manifest: defineManifest({ id: 'plain', title: 'Plain', modules: [], targets: ['mobile'] }),
    createState: () => ({}),
    handlers: [],
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
  });
  const without = await openMobileAuthority(plain, {
    platform: createMobilePlatform({
      id: 'ios',
      openDatabase: (name) => bunSqlDriver(join(sandbox, name)),
      openBlobs: (workspace) => createFileBlobStore(join(sandbox, workspace, 'blobs')),
    }),
  });
  opened.push(without);
  let subscribed = false;
  const inert = connectMobileShell(without, plain, {
    ...device(`${scheme}://notes/n-1`, {}).bindings,
    subscribe: () => ((subscribed = true), () => undefined),
  });
  const shown: OsDelivery[] = [];
  inert.deliveries.subscribe((delivery) => shown.push(delivery));
  await settle();
  expect(subscribed).toBe(false);
  expect(shown).toEqual([]);
});

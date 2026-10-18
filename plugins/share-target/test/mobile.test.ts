import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileBlobStore } from '@agent-native/adapters/blob-files';
import { bunSqlDriver } from '@agent-native/adapters/sqlite';
import type { OsDelivery } from '@agent-native/contracts';
import {
  connectMobileShell,
  createMobilePlatform,
  openMobileInstance,
  type MobileInstance,
  type MobileOsBindings,
} from '@agent-native/mobile';
import type { MobileShare } from '@agent-native/shell/mobile';
import { notesApplication, scheme } from './fixture';

const sandboxes: string[] = [];
const opened: MobileInstance[] = [];
afterEach(async () => {
  for (const instance of opened.splice(0)) await instance.close();
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

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

test('items another app shared prefill the form; a share action opens the share sheet', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'share-mobile-'));
  sandboxes.push(sandbox);
  const application = notesApplication();
  const instance = await openMobileInstance(application, {
    platform: createMobilePlatform({
      id: 'android',
      openDatabase: (name) => bunSqlDriver(join(sandbox, name)),
      openBlobs: (workspace) => createFileBlobStore(join(sandbox, workspace, 'blobs')),
    }),
    settings: { 'os-scheme': scheme },
  });
  opened.push(instance);

  // The device, faked: `expo-sharing` opens the app with `<scheme>://expo-sharing` and holds
  // the items until they are taken.
  let pending: MobileShare[] = [];
  const files: Record<string, { name: string; type: string; bytes: Uint8Array }> = {
    'content://scans/7': {
      name: 'Receipt.pdf',
      type: 'application/pdf',
      bytes: new TextEncoder().encode('%PDF-1'),
    },
  };
  const listeners = new Set<(uri: string) => void>();
  const read: string[] = [];
  const sheets: unknown[] = [];
  const bindings: MobileOsBindings = {
    platform: 'android',
    scheme,
    initialUri: async () => null,
    subscribe: (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    inspect: async (uri) => {
      const file = files[uri];
      return file && { name: file.name, size: file.bytes.byteLength, mediaType: file.type };
    },
    read: async (uri) => (read.push(uri), files[uri]?.bytes),
    open: async () => undefined,
    shared: async (uri) => {
      if (uri !== `${scheme}://expo-sharing`) return undefined;
      const items = pending;
      pending = [];
      return items;
    },
    share: async (content) => void sheets.push(content),
  };
  const connection = connectMobileShell(instance, application, bindings);
  const shown: OsDelivery[] = [];
  connection.deliveries.subscribe((delivery) => shown.push(delivery));
  const send = (uri: string) => listeners.forEach((listener) => listener(uri));

  pending = [
    { kind: 'text', text: 'Buy milk' },
    { kind: 'file', uri: 'content://scans/7' },
    // A type no share handler accepts is never read.
    { kind: 'file', uri: 'content://media/9', mediaType: 'video/mp4' },
  ];
  send(`${scheme}://expo-sharing`);
  await until(() => shown.length === 2);
  await settle();
  expect(read).toEqual(['content://scans/7']);
  expect(shown).toHaveLength(2);
  expect(shown[0]).toEqual({
    type: 'prepare',
    operation: 'notes.create',
    input: { body: 'Buy milk' },
    provenance: { kind: 'share', handler: 'note.from-shared-text' },
  });
  expect((shown[1] as Extract<OsDelivery, { type: 'prepare' }>).input).toMatchObject({
    title: 'Receipt.pdf',
    scan: { size: 6, mediaType: 'application/pdf' },
  });

  // The share link carries nothing itself: opened again, it shows nothing.
  send(`${scheme}://expo-sharing`);
  await settle();
  expect(shown).toHaveLength(2);

  expect(
    await instance.instance.ports.shell.perform(instance.context, {
      action: 'notes.share',
      params: { text: 'Buy milk', url: 'https://example.com/n/1' },
    }),
  ).toEqual({ status: 'performed', action: 'notes.share' });
  expect(sheets).toEqual([{ text: 'Buy milk', url: 'https://example.com/n/1' }]);
  connection.close();
});

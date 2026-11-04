import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileBlobStore } from '@tortoise/adapters/blob-files';
import { bunSqlDriver } from '@tortoise/adapters/sqlite';
import type { AnyApplicationDefinition } from '@tortoise/kernel/application';
import {
  connectMobileShell,
  createMobilePlatform,
  openMobileInstance,
  type MobileInstance,
} from '@tortoise/mobile';
import type { OsDelivery } from '@tortoise/contracts';
import { shortcutLink } from '@tortoise/shell/shortcuts';
import { notesApplication, scheme } from './fixture';

const sandboxes: string[] = [];
const opened: MobileInstance[] = [];
afterEach(async () => {
  for (const instance of opened.splice(0)) await instance.close();
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

async function open(application: AnyApplicationDefinition) {
  const sandbox = mkdtempSync(join(tmpdir(), 'shortcuts-'));
  sandboxes.push(sandbox);
  const instance = await openMobileInstance(application, {
    platform: createMobilePlatform({
      id: 'android',
      openDatabase: (name) => bunSqlDriver(join(sandbox, name)),
      openBlobs: (workspace) => createFileBlobStore(join(sandbox, workspace, 'blobs')),
    }),
    settings: { 'os-scheme': scheme },
  });
  opened.push(instance);
  return instance;
}

/** Wait until `condition` holds, polling; fails the test after two seconds. */
async function until(condition: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the device');
    await Bun.sleep(5);
  }
}

test('a shortcut link, as a launcher opens it, prefills the form with its provenance', async () => {
  const application = notesApplication();
  const instance = await open(application);
  const listeners = new Set<(uri: string) => void>();
  const reports: string[] = [];
  const connection = connectMobileShell(instance, application, {
    platform: 'android',
    scheme,
    // An Android app shortcut is a VIEW intent with the link, which `Linking` reports.
    initialUri: async () => shortcutLink(scheme, 'note.new'),
    subscribe: (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    inspect: async () => undefined,
    read: async () => undefined,
    open: async () => undefined,
    report: (message) => void reports.push(message),
  });
  const shown: OsDelivery[] = [];
  connection.deliveries.subscribe((delivery) => shown.push(delivery));
  await until(() => shown.length === 1);
  expect(shown).toEqual([
    {
      type: 'prepare',
      operation: 'notes.create',
      input: {},
      provenance: { kind: 'shortcut', handler: 'note.new' },
    },
  ]);

  // An undeclared shortcut, and a shortcut link with anything more, are refused.
  for (const uri of [
    shortcutLink(scheme, 'note.other'),
    `${shortcutLink(scheme, 'note.new')}&title=x`,
    `${scheme}://notes/?os-shortcut=note.new`,
  ])
    listeners.forEach((listener) => listener(uri));
  await until(() => reports.length === 3);
  expect(reports.every((message) => message.startsWith('OS request refused'))).toBe(true);
  expect(shown).toHaveLength(1);
  connection.close();
});

test('startup refuses shortcut declarations without the plugin', async () => {
  await expect(open(notesApplication({ shortcuts: false }))).rejects.toThrow('shortcut');
});

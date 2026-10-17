import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileBlobStore } from '@agent-native/adapters/blob-files';
import { bunSqlDriver } from '@agent-native/adapters/sqlite';
import type { AnyApplicationDefinition } from '@agent-native/kernel/application';
import type { OsDelivery } from '@agent-native/contracts';
import {
  connectMobileShell,
  createMobilePlatform,
  openMobileAuthority,
  type MobileAuthority,
  type MobileOsBindings,
} from '@agent-native/mobile';
import type { AndroidIntent, IntentListening } from '@agent-native/shell/intents';
import { createAction, notesApplication, scheme } from './fixture';

const sandboxes: string[] = [];
const opened: MobileAuthority[] = [];
afterEach(async () => {
  for (const authority of opened.splice(0)) await authority.close();
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

async function open(application: AnyApplicationDefinition, platform: 'android' | 'ios') {
  const sandbox = mkdtempSync(join(tmpdir(), 'intents-mobile-'));
  sandboxes.push(sandbox);
  const authority = await openMobileAuthority(application, {
    platform: createMobilePlatform({
      id: platform,
      openDatabase: (name) => bunSqlDriver(join(sandbox, name)),
      openBlobs: (workspace) => createFileBlobStore(join(sandbox, workspace, 'blobs')),
    }),
    settings: { 'os-scheme': scheme },
  });
  opened.push(authority);
  return authority;
}

/** The device, faked: the native module's launching intent, later intents and started ones. */
function device(launched?: unknown) {
  const reports: string[] = [];
  const started: AndroidIntent[] = [];
  let listening: IntentListening | undefined;
  let deliver: ((record: unknown) => void) | undefined;
  const bindings: MobileOsBindings = {
    platform: 'android',
    scheme,
    initialUri: async () => null,
    subscribe: () => () => undefined,
    inspect: async () => undefined,
    read: async () => undefined,
    open: async () => undefined,
    intents(declared, listener) {
      listening = declared;
      deliver = listener;
      if (launched) listener(launched);
      return () => {
        deliver = undefined;
      };
    },
    startIntent: async (intent) => void started.push(intent),
    report: (message) => void reports.push(message),
  };
  return {
    bindings,
    reports,
    started,
    listening: () => listening,
    send: (record: unknown) => deliver?.(record),
  };
}

test('an intent with a declared action prefills the form; others are dropped', async () => {
  const application = notesApplication();
  const authority = await open(application, 'android');
  const fake = device({
    action: createAction,
    categories: ['android.intent.category.DEFAULT'],
    data: 'https://example.com/list/4',
    extras: { title: 'Groceries' },
  });
  const connection = connectMobileShell(authority, application, fake.bindings);
  const shown: OsDelivery[] = [];
  connection.deliveries.subscribe((delivery) => shown.push(delivery));
  await until(() => shown.length === 1);

  // The device reads only the declared action's declared extras.
  expect(fake.listening()).toEqual({ [createAction]: { title: 'string', copies: 'number' } });
  expect(shown).toEqual([
    {
      type: 'prepare',
      operation: 'notes.create',
      input: { title: 'Groceries', body: 'https://example.com/list/4' },
      provenance: { kind: 'intent', handler: 'note.from-intent' },
    },
  ]);

  // An undeclared action, an extra the schema refuses and a malformed record show nothing.
  fake.send({ action: 'android.intent.action.MAIN' });
  fake.send({ action: createAction, extras: { title: 'x'.repeat(41) } });
  fake.send({ action: createAction, extras: { title: 'Notes', owner: 'mallory' } });
  fake.send('not an intent');
  await until(() => fake.reports.length === 4);
  expect(shown).toHaveLength(1);
  expect(fake.reports.filter((message) => message.includes('not one'))).toHaveLength(2);
  expect(fake.reports.filter((message) => message.startsWith('OS request refused'))).toHaveLength(
    2,
  );
  connection.close();
});

test('an intent action starts the declared package with the checked extras', async () => {
  const application = notesApplication();
  const authority = await open(application, 'android');
  const fake = device();
  const connection = connectMobileShell(authority, application, fake.bindings);
  const perform = (params: unknown) =>
    authority.authority.ports.shell.perform(authority.context, {
      action: 'notes.scan',
      params: params as never,
    });

  expect(await perform({ prompt: 'Receipt', copies: 2 })).toEqual({
    status: 'performed',
    action: 'notes.scan',
  });
  expect(fake.started).toEqual([
    {
      action: 'com.example.scanner.action.SCAN',
      package: 'com.example.scanner',
      extras: { prompt: 'Receipt', copies: 2 },
    },
  ]);
  // The caller supplies extras only, within the declared schema: never the action or package.
  expect(await perform({ prompt: 'Receipt', copies: 2, package: 'com.example.other' })).toEqual({
    status: 'refused',
    reason: 'invalid',
    action: 'notes.scan',
  });
  expect(await perform({ prompt: 'Receipt', copies: 9 })).toMatchObject({ reason: 'invalid' });
  expect(fake.started).toHaveLength(1);
  connection.close();
});

test('without the native module, intents neither arrive nor start', async () => {
  const application = notesApplication();
  const authority = await open(application, 'ios');
  const { intents: _intents, startIntent: _start, ...bindings } = device().bindings;
  const reports: string[] = [];
  const connection = connectMobileShell(authority, application, {
    ...bindings,
    platform: 'ios',
    report: (message) => void reports.push(message),
  });
  expect(
    await authority.authority.ports.shell.perform(authority.context, {
      action: 'notes.scan',
      params: { prompt: 'Receipt', copies: 1 },
    }),
  ).toMatchObject({ status: 'refused', reason: 'failed' });
  // iOS has no intents, so their absence is no fault there.
  expect(reports).toEqual([]);
  connection.close();
});

test('an Android build without the module says so', async () => {
  const application = notesApplication();
  const authority = await open(application, 'android');
  const { intents: _intents, ...bindings } = device().bindings;
  const reports: string[] = [];
  const connection = connectMobileShell(authority, application, {
    ...bindings,
    report: (message) => void reports.push(message),
  });
  expect(reports).toEqual(['This build cannot receive intents: it has no intent module']);
  connection.close();
});

test('startup refuses intent declarations without the plugin', async () => {
  await expect(open(notesApplication({ intents: false }), 'android')).rejects.toThrow('intent');
});

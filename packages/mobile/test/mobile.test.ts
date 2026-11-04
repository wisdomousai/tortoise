import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createFileBlobStore } from '@tortoise/adapters/blob-files';
import { bunSqlDriver } from '@tortoise/adapters/sqlite';
import {
  blobRefSchema,
  defineCapability,
  defineHostComponent,
  defineModule,
  jsonSchema,
} from '@tortoise/contracts';
import { defineApplication, type ApplicationConnections } from '@tortoise/kernel/application';
import { defineHostPlugin } from '@tortoise/kernel/plugin';
import { definePluginManifest } from '@tortoise/kernel/plugin-manifest';
import { createHandlerFactory } from '@tortoise/runtime';
import { defineManifest } from '@tortoise/kernel/manifest';
import { createMobilePlatform, openMobileInstance, type MobileBindings } from '../src/index';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/** The platform with Bun's SQLite and files in place of Expo's, in a fresh app sandbox. */
function bindings(id: 'android' | 'ios' = 'android'): MobileBindings {
  const sandbox = mkdtempSync(join(tmpdir(), 'mobile-'));
  directories.push(sandbox);
  return {
    id,
    openDatabase: (name) => bunSqlDriver(join(sandbox, name)),
    openBlobs: (workspace) => createFileBlobStore(join(sandbox, workspace, 'blobs')),
  };
}

const capture = defineCapability({
  id: 'capture.record',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string(), photo: blobRefSchema })),
  output: jsonSchema(z.strictObject({ count: z.number() })),
  permission: { action: 'create', resourceType: 'capture' },
  ui: { exception: 'test fixture' },
  blobs: { maxBytes: 1024, mediaTypes: ['image/jpeg'] },
});
const list = defineCapability({
  id: 'capture.list',
  kind: 'query',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({ ids: z.array(z.string()) })),
  permission: { action: 'read', resourceType: 'capture' },
  ui: { exception: 'test fixture' },
});
type State = { captures: string[] };
const bind = createHandlerFactory<State, unknown>();

function field(
  components: Parameters<typeof defineManifest>[0]['components'] = [],
  extra: {
    plugins?: Parameters<typeof defineApplication>[0]['plugins'];
    connect?: () => ApplicationConnections;
  } = {},
) {
  return defineApplication<State>({
    manifest: defineManifest({
      id: 'field',
      title: 'Field',
      modules: [defineModule({ id: 'captures', capabilities: [capture, list] })],
      components,
      plugins: (extra.plugins ?? []).map((plugin) => plugin.manifest),
    }),
    ...extra,
    createState: () => ({ captures: [] }),
    handlers: [
      bind(capture, async (input, ctx) => {
        ctx.state.captures.push(input.id);
        ctx.change(`capture:${input.id}`);
        ctx.attach(`capture:${input.id}`, input.photo);
        return { count: ctx.state.captures.length };
      }),
      bind(list, async (_input, ctx) => ({ ids: ctx.state.captures })),
    ],
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
  });
}

test('the field app commits a capture with a photo, closes, reopens and finds both', async () => {
  const platform = createMobilePlatform(bindings());
  const first = await openMobileInstance(field(), { platform });
  const photo = new Uint8Array([255, 216, 255, 224]);
  const ref = await first.transport.blobs!.put(photo, 'image/jpeg');
  await first.transport.command(
    'capture.record',
    { id: 'c1', photo: ref },
    { idempotencyKey: 'capture-1' },
  );
  // One writer: neither the app nor a background task can open the workspace again.
  await expect(openMobileInstance(field(), { platform })).rejects.toThrow('live instance');
  await first.close();

  const second = await openMobileInstance(field(), { platform });
  expect((await second.transport.query('capture.list', {})).data).toEqual({ ids: ['c1'] });
  expect((await second.transport.blobs!.get(ref.digest)).data).toEqual(photo);
  await second.close();
});

test('a deployment that needs sockets, a listener or a child process refuses to start', async () => {
  const platform = createMobilePlatform(bindings('ios'));
  const listener = defineHostComponent({
    id: 'listener',
    description: 'fixture',
    requirements: {
      network: [
        {
          id: 'inbound',
          purpose: 'fixture',
          direction: 'inbound',
          scope: 'loopback',
          protocol: 'https',
          dataClasses: ['test-record'],
          availability: 'required',
          offline: 'unavailable',
        },
      ],
    },
  });
  await expect(openMobileInstance(field([listener]), { platform })).rejects.toThrow(
    'Platform "ios" cannot run this deployment',
  );
  // Refused before anything opened: the workspace is free again.
  const opened = await openMobileInstance(field(), { platform });
  await opened.close();
});

test('workspace names on a device cannot address another path', async () => {
  const platform = createMobilePlatform(bindings());
  await expect(openMobileInstance(field(), { platform, workspace: '../other' })).rejects.toThrow(
    'Invalid workspace name',
  );
});

test('foreground and background start and stop the integration loops', async () => {
  const platform = createMobilePlatform(bindings());
  const opened = await openMobileInstance(field(), { platform });
  opened.foreground();
  opened.foreground();
  await opened.background();
  expect(await opened.backgroundPass(100)).toMatchObject({ synced: [] });
  await opened.close();
  await opened.close();
});

test('each foreground starts the plugin and application observers again; background and close stop them', async () => {
  const calls: string[] = [];
  const observer = (name: string) => ({ stop: async () => void calls.push(`stop ${name}`) });
  const plugin = defineHostPlugin({
    manifest: definePluginManifest({
      id: 'watcher',
      title: 'Watcher',
      platforms: ['bun', 'android', 'ios'],
    }),
    open: async () => ({
      async start(context) {
        calls.push(`start ${context.delegate({ operations: [] }).principalId}`);
        return [observer('plugin')];
      },
    }),
  });
  const connect = () => ({
    observe: async () => {
      calls.push('observe');
      return [observer('application')];
    },
  });
  const opened = await openMobileInstance(field([], { plugins: [plugin], connect }), {
    platform: createMobilePlatform(bindings()),
  });
  expect(calls).toEqual([]);
  opened.foreground();
  opened.foreground();
  await opened.background();
  expect(calls).toEqual(['start owner', 'observe', 'stop plugin', 'stop application']);
  calls.length = 0;
  await opened.backgroundPass(100);
  expect(calls).toEqual([]);
  opened.foreground();
  await opened.close();
  expect(calls).toEqual(['start owner', 'observe', 'stop plugin', 'stop application']);
  opened.foreground();
  expect(calls).toHaveLength(4);
});

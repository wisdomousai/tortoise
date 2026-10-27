import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  defineCapability,
  defineModule,
  jsonSchema,
  type AuditRecord,
  type EventLogPort,
  type OsHandler,
} from '@agent-native/contracts';
import { defineApplication } from '@agent-native/host/application';
import { startHost } from '@agent-native/host/host';
import { defineManifest } from '@agent-native/host/manifest';
import { defineHostPlugin } from '@agent-native/host/plugin';
import { definePluginManifest } from '@agent-native/host/plugin-manifest';
import type { AuthorizationPort } from '@agent-native/runtime';
import { createOsPlugin } from '../src/plugin';
import { osPluginManifest } from '../src/plugin-manifest';

// A fixture application: notes that can be opened by link and created from a text file.
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
  input: jsonSchema(z.strictObject({ title: z.string().max(40), body: z.string() })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Note' },
  ui: { binding: 'notes.create' },
});
const handlers: OsHandler[] = [
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
    description: 'Create a note from a text file.',
    types: [{ extensions: ['txt'], mediaTypes: ['text/plain'], description: 'Text' }],
    role: 'viewer',
    payload: 'text',
    maxBytes: 1024,
    target: { prepare: 'notes.create', input: { title: '{file.stem}', body: '{file.text}' } },
  },
];
const docs = {
  id: 'notes.docs',
  kind: 'open' as const,
  description: 'Open the notes guide.',
  url: 'https://docs.example.com/notes/{page}',
  params: jsonSchema(z.strictObject({ page: z.string() })),
  dataClasses: ['docs-link'],
};
const notesModule = (extra: OsHandler[] = []) =>
  defineModule({
    id: 'notes',
    capabilities: [noteGet, noteCreate],
    os: { handlers: [...handlers, ...extra], actions: [docs] },
  });
const readable: AuthorizationPort<unknown> = {
  authorize: ({ input }) => ({ allowed: (input as { id?: string }).id !== 'n-9' }),
  canReadEvent: () => true,
};

/** An event log that keeps records in memory, so the test can read what was audited. */
function memoryLog(records: AuditRecord[]) {
  const manifest = definePluginManifest({ id: 'memory-log', title: 'Memory log' });
  return {
    manifest,
    plugin: defineHostPlugin({
      manifest,
      open: async () => ({
        ports: {
          eventLog: {
            mode: { commands: 'best-effort', queries: 'best-effort', egress: 'best-effort' },
            append: async (batch: readonly AuditRecord[]) => {
              records.push(...batch);
              return [];
            },
          } as EventLogPort,
        },
      }),
    }),
  };
}

function notesApplication(
  options: { os?: boolean; extra?: OsHandler[]; records?: AuditRecord[] } = {},
) {
  const log = memoryLog(options.records ?? []);
  const os = options.os === false ? [] : [{ manifest: osPluginManifest, plugin: createOsPlugin() }];
  return defineApplication<Record<string, never>>({
    manifest: defineManifest({
      id: 'notes',
      title: 'Notes',
      modules: [notesModule(options.extra)],
      plugins: [log.manifest, ...os.map((item) => item.manifest)],
    }),
    createState: () => ({}),
    handlers: [
      {
        capability: noteGet,
        handle: async (input: { id: string }) => ({ id: input.id, revision: 1 }),
      },
      { capability: noteCreate, handle: async () => ({}) },
    ],
    authorization: readable,
    selectableResources: { note: 'notes.get' },
    plugins: [log.plugin, ...os.map((item) => item.plugin)],
  });
}

const directories: string[] = [];
afterAll(() => Promise.all(directories.map((path) => rm(path, { recursive: true, force: true }))));
async function serve(
  application: ReturnType<typeof notesApplication>,
  settings: Record<string, string> = { 'os-scheme': 'dev.example.notes' },
) {
  const directory = await mkdtemp(join(tmpdir(), 'os-'));
  directories.push(directory);
  await mkdir(join(directory, 'web'));
  await writeFile(join(directory, 'web', 'index.html'), '<!doctype html><title>Notes</title>');
  const host = await startHost(application, {
    workspacePath: join(directory, 'workspace'),
    webRoot: join(directory, 'web'),
    integration: false,
    settings,
  });
  const session = () => {
    const token = host.sessions.create({ workspaceId: 'local', principalId: 'owner' }).token;
    return (path: string, body?: unknown) =>
      fetch(`${host.url}/api/v1/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
  };
  return { host, session };
}
const submit = (call: ReturnType<Awaited<ReturnType<typeof serve>>['session']>, request: unknown) =>
  call('shell/requests', { platform: 'macos', request }).then((response) => response.json());

describe('OS plugin', () => {
  test('without the plugin the shell API is unavailable', async () => {
    const { host, session } = await serve(notesApplication({ os: false }), {});
    try {
      const response = await session()('shell/requests', {
        platform: 'macos',
        request: { kind: 'url', url: 'x' },
      });
      expect(response.status).toBe(503);
    } finally {
      await host.close();
    }
  });

  test('a link opens the resource for the submitting session only, and the log holds no content', async () => {
    const records: AuditRecord[] = [];
    const { host, session } = await serve(notesApplication({ records }));
    try {
      const mine = session();
      const other = session();
      expect(await submit(mine, { kind: 'url', url: 'dev.example.notes://notes/n-1' })).toEqual({
        status: 'delivered',
        handler: 'note.open',
      });
      const deliveries = await (await mine('ui/deliveries')).json();
      expect(deliveries).toMatchObject([
        {
          delivery: {
            type: 'openResource',
            resource: 'note:n-1',
            provenance: { kind: 'link', handler: 'note.open' },
          },
        },
      ]);
      expect(await (await other('ui/deliveries')).json()).toEqual([]);
      expect(
        (await mine(`ui/deliveries/${deliveries[0].id}/ack`, { status: 'accepted' })).status,
      ).toBe(200);
      expect(await (await mine('ui/deliveries')).json()).toEqual([]);

      // A note the caller may not read is refused when queued, so the sender learns nothing more.
      expect(
        (
          await mine('shell/requests', {
            platform: 'macos',
            request: { kind: 'url', url: 'dev.example.notes://notes/n-9' },
          })
        ).status,
      ).toBe(403);

      expect(
        await submit(mine, {
          kind: 'file',
          name: 'Groceries.txt',
          mediaType: 'text/plain',
          text: 'milk',
        }),
      ).toMatchObject({ status: 'delivered' });
      const [prepared] = await (await mine('ui/deliveries')).json();
      expect(prepared.delivery).toEqual({
        type: 'prepare',
        operation: 'notes.create',
        input: { title: 'Groceries', body: 'milk' },
        provenance: { kind: 'file', handler: 'note.from-text', label: 'Groceries.txt' },
      });
      const logged = JSON.stringify(records);
      expect(logged).not.toContain('milk');
      expect(logged).not.toContain('Groceries');
      // Received means matched to a handler; the refused note's delivery was authorized separately.
      expect(records.filter((record) => record.kind === 'os.request.received')).toHaveLength(3);
      expect(
        records
          .filter((record) => record.kind.startsWith('os.'))
          .every((record) => record.actor?.via === 'shell'),
      ).toBe(true);
    } finally {
      await host.close();
    }
  });

  test('refusals carry reason codes and nothing is delivered', async () => {
    const { host, session } = await serve(notesApplication(), {
      'os-scheme': 'dev.example.notes',
      'os-disabled': 'note.from-text',
    });
    try {
      const call = session();
      expect(await submit(call, { kind: 'url', url: 'dev.example.notes://elsewhere/1' })).toEqual({
        status: 'refused',
        reason: 'no-handler',
      });
      expect(
        await submit(call, { kind: 'url', url: 'dev.example.notes://notes/drop table' }),
      ).toEqual({ status: 'refused', reason: 'invalid' });
      expect(await submit(call, { kind: 'file', name: 'a.txt', text: 'x' })).toEqual({
        status: 'refused',
        reason: 'disabled',
        handler: 'note.from-text',
      });
      expect(
        await submit(call, { kind: 'url', url: 'https://notes.example.com/notes/n-1' }),
      ).toEqual({ status: 'refused', reason: 'no-handler' });
      const outcomes = [];
      for (let index = 0; index < 31; index++)
        outcomes.push(
          (await submit(call, { kind: 'url', url: 'dev.example.notes://notes/n-2' })).status,
        );
      expect(outcomes.at(-1)).toBe('refused');
      expect(await (await call('ui/deliveries')).json()).toHaveLength(16);
    } finally {
      await host.close();
    }
  });

  test('an open action is built from its template and relayed to the attached adapter', async () => {
    const { host, session } = await serve(notesApplication());
    try {
      const page = session();
      expect(
        await (
          await page('shell/actions', { action: 'notes.docs', params: { page: 'a/b' } })
        ).json(),
      ).toEqual({
        status: 'instruction',
        instruction: {
          kind: 'open',
          action: 'notes.docs',
          url: 'https://docs.example.com/notes/a%2Fb',
        },
      });
      expect(await (await page('shell/actions', { action: 'notes.other' })).json()).toMatchObject({
        status: 'refused',
        reason: 'no-handler',
      });

      const main = session();
      const polled = main('shell/actions?platform=macos');
      await Bun.sleep(20);
      const performed = page('shell/actions', { action: 'notes.docs', params: { page: 'start' } });
      const relayed = await (await polled).json();
      expect(relayed.instruction).toEqual({
        kind: 'open',
        action: 'notes.docs',
        url: 'https://docs.example.com/notes/start',
      });
      expect((await page(`shell/actions/${relayed.id}/result`, { ok: true })).status).toBe(404);
      expect((await main(`shell/actions/${relayed.id}/result`, { ok: true })).status).toBe(200);
      expect(await (await performed).json()).toEqual({ status: 'performed', action: 'notes.docs' });
    } finally {
      await host.close();
    }
  });

  test('the launch page for a link is the only cross-site request served, and only as a page', async () => {
    const { host } = await serve(notesApplication());
    try {
      const visit = (path: string, mode = 'navigate', dest = 'document') =>
        fetch(`${host.url}${path}`, {
          headers: {
            'sec-fetch-site': 'cross-site',
            'sec-fetch-mode': mode,
            'sec-fetch-dest': dest,
          },
        });
      const launchPage = await visit(
        `/?os=${encodeURIComponent('web+devexamplenotes://notes/n-1')}`,
      );
      expect(launchPage.status).toBe(200);
      expect(await launchPage.text()).toContain('<title>Notes</title>');
      expect((await visit('/?os-shortcut=new-note')).status).toBe(200);
      for (const refused of [
        visit('/'),
        visit('/?os=x&extra=1'),
        visit('/index.html?os=x'),
        visit('/?os=x', 'cors', 'empty'),
        visit('/?os=x', 'navigate', 'iframe'),
        visit('/api/v1/ui/deliveries?os=x'),
      ])
        expect((await refused).status).toBe(403);
    } finally {
      await host.close();
    }
  });

  test('a declared kind that no composed plugin serves refuses startup', async () => {
    const share: OsHandler = {
      id: 'note.shared',
      kind: 'share',
      description: 'Shared text.',
      accepts: { text: true },
      maxBytes: 1024,
      target: { prepare: 'notes.create', input: { body: '{text}' } },
    };
    await expect(serve(notesApplication({ extra: [share] }))).rejects.toThrow(
      'needs a plugin that serves share',
    );
    await expect(serve(notesApplication(), { 'os-disabled': 'missing' })).rejects.toThrow(
      'unknown id missing',
    );
  });
});

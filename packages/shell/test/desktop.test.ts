import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  blobRefSchema,
  buildCatalog,
  defineCapability,
  defineModule,
  jsonSchema,
  type CatalogOs,
  type OsActionOutcome,
  type OsHandler,
  type OsInstruction,
  type RawOsRequest,
} from '@tortoise/contracts';
import {
  createDesktopShell,
  desktopArguments,
  launchRequest,
  openActionFor,
  receivedArguments,
  type DesktopShellClient,
} from '../src/index';

const scheme = 'dev.example.notes';
const create = defineCapability({
  id: 'notes.create',
  kind: 'command',
  input: jsonSchema(
    z.strictObject({
      title: z.string(),
      body: z.string().optional(),
      scan: blobRefSchema.optional(),
    }),
  ),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Note' },
  ui: { binding: 'notes.create' },
  blobs: { maxBytes: 1024, mediaTypes: ['image/png'] },
});
const fromText: OsHandler = {
  id: 'note.from-text',
  kind: 'file',
  description: 'Create a note from a text file.',
  types: [{ extensions: ['txt'], mediaTypes: ['text/plain'], description: 'Text' }],
  role: 'viewer',
  payload: 'text',
  maxBytes: 64,
  target: { prepare: 'notes.create', input: { title: '{file.stem}', body: '{file.text}' } },
};
const fromScan: OsHandler = {
  id: 'note.from-scan',
  kind: 'file',
  description: 'Create a note from a scanned page.',
  types: [{ extensions: ['png'], mediaTypes: ['image/png'], description: 'PNG image' }],
  role: 'viewer',
  payload: 'blob',
  maxBytes: 1024,
  target: { prepare: 'notes.create', input: { title: '{file.stem}', scan: '{file.blob}' } },
};
const os = buildCatalog([
  defineModule({
    id: 'notes',
    capabilities: [create],
    os: {
      handlers: [fromText, fromScan],
      actions: [
        {
          id: 'notes.docs',
          kind: 'open',
          description: 'Open a guide page.',
          url: 'https://docs.example.com/notes/{page}',
          params: jsonSchema(
            z.strictObject({
              page: z.string().regex(/^[a-z-]+$/),
              lang: z.enum(['en', 'de']).optional(),
            }),
          ),
          dataClasses: ['docs-link'],
        },
      ],
    },
  }),
]).os!;

describe('desktop arguments', () => {
  test('after -- only the link or file counts; switches before it are never read', () => {
    expect(
      desktopArguments(
        ['app', '--inspect=9229', '--', `${scheme}://notes/n-1`, '/tmp/a.txt'],
        scheme,
        1,
      ),
    ).toEqual({ urls: [`${scheme}://notes/n-1`], paths: ['/tmp/a.txt'] });
    expect(desktopArguments(['app', '--', '--inspect', 'other://x'], scheme, 1)).toEqual({
      urls: [],
      paths: [],
    });
  });

  test('without -- switches, relative paths, UNC paths and other schemes are ignored', () => {
    expect(
      desktopArguments(
        [
          'app',
          'main.mjs',
          '--flag',
          'notes.txt',
          '\\\\server\\share\\a.txt',
          '//server/share/a.txt',
          'C:\\Notes\\a.txt',
        ],
        scheme,
        2,
      ),
    ).toEqual({ urls: [], paths: ['C:\\Notes\\a.txt'] });
  });

  test('data a second instance hands over is classified again', () => {
    expect(
      receivedArguments(
        { urls: [`${scheme}://notes/n-1`, 'https://evil.example', 7], paths: ['relative', '/a'] },
        scheme,
      ),
    ).toEqual({ urls: [`${scheme}://notes/n-1`], paths: ['/a'] });
    expect(receivedArguments('nonsense', scheme)).toEqual({ urls: [], paths: [] });
  });
});

describe('launch URL', () => {
  test('exactly one launch parameter becomes a request; anything else is ignored', () => {
    expect(launchRequest('?os=web%2Bnotes%3A%2F%2Fnotes%2Fn-1')).toEqual({
      kind: 'url',
      url: 'web+notes://notes/n-1',
    });
    expect(launchRequest('?os-shortcut=new-note')).toEqual({ kind: 'shortcut', id: 'new-note' });
    for (const search of ['', '?os=a&os=b', '?os=a&next=b', '?other=1', '?os-shortcut=New Note'])
      expect(launchRequest(search)).toBeUndefined();
    expect(launchRequest(`?os=${'a'.repeat(2049)}`)).toBeUndefined();
  });
});

describe('open action lookup', () => {
  test('a URL is accepted only in a shape a declared action builds', () => {
    expect(openActionFor(os.actions, 'https://docs.example.com/notes/start?lang=de')).toEqual({
      action: 'notes.docs',
      params: { page: 'start', lang: 'de' },
    });
    for (const url of [
      'https://docs.example.com/notes/start?lang=fr',
      'https://docs.example.com/notes/start?extra=1',
      'https://docs.example.com/notes/start?lang=en&lang=de',
      'https://docs.example.com/notes/start#top',
      'https://user@docs.example.com/notes/start',
      'https://docs.example.com.evil.example/notes/start',
      'https://docs.example.com/notes/a/b',
      'http://docs.example.com/notes/start',
      'not a url',
    ])
      expect(openActionFor(os.actions, url)).toBeUndefined();
  });
});

function fakeClient(outcome: OsActionOutcome | undefined) {
  const submitted: RawOsRequest[] = [];
  const responses: unknown[] = [];
  const relayed: { id: string; instruction: OsInstruction }[] = [];
  const uploads: { size: number; mediaType: string }[] = [];
  const client: DesktopShellClient = {
    declarations: async () => os as CatalogOs,
    submit: async (request) => (submitted.push(request), { status: 'delivered' }),
    perform: async () => outcome,
    next: async (signal) => {
      const item = relayed.shift();
      if (item) return item;
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      return undefined;
    },
    respond: async (id, result) => void responses.push({ id, result }),
    upload: async (bytes, mediaType) => (
      uploads.push({ size: bytes.byteLength, mediaType }),
      { digest: `sha256:${'a'.repeat(64)}`, size: bytes.byteLength, mediaType }
    ),
  };
  return { client, submitted, responses, relayed, uploads };
}

describe('desktop shell', () => {
  test('input before connect is buffered, and only declared files are read', async () => {
    const fake = fakeClient(undefined);
    const read: string[] = [];
    let focused = 0;
    const desktop = createDesktopShell({
      platform: 'macos',
      client: fake.client,
      readFile: async (path, maxBytes) => {
        read.push(path);
        if (path.endsWith('big.png')) return maxBytes < 2048 ? undefined : new Uint8Array(2048);
        return new TextEncoder().encode(path.endsWith('.png') ? 'png!' : 'milk');
      },
      open: async () => undefined,
      reveal: async () => ({ ok: true }),
      openFile: async () => ({ ok: true }),
      focus: () => focused++,
    });
    await desktop.receive({
      urls: [`${scheme}://notes/n-1`],
      paths: ['/x/Groceries.txt', '/x/a.pdf', '/x/Receipt.png', '/x/big.png'],
    });
    expect(fake.submitted).toEqual([]);
    await desktop.connect();
    expect(read).toEqual(['/x/Groceries.txt', '/x/Receipt.png', '/x/big.png']);
    // The blob payload is uploaded first, as the declared media type, and sent as its reference.
    expect(fake.uploads).toEqual([{ size: 4, mediaType: 'image/png' }]);
    expect(fake.submitted).toEqual([
      { kind: 'url', url: `${scheme}://notes/n-1` },
      { kind: 'file', name: 'Groceries.txt', text: 'milk' },
      {
        kind: 'file',
        name: 'Receipt.png',
        mediaType: 'image/png',
        blob: { digest: `sha256:${'a'.repeat(64)}`, size: 4, mediaType: 'image/png' },
      },
    ]);
    expect(focused).toBe(3);
    desktop.close();
  });

  test('relayed opens are checked again; page opens without a shell port are rebuilt', async () => {
    const fake = fakeClient(undefined);
    const opened: string[] = [];
    fake.relayed.push(
      {
        id: 'a',
        instruction: {
          kind: 'open',
          action: 'notes.docs',
          url: 'https://docs.example.com/notes/x',
        },
      },
      {
        id: 'b',
        instruction: { kind: 'open', action: 'notes.docs', url: 'https://evil.example/' },
      },
      { id: 'c', instruction: { kind: 'share', action: 'notes.share', text: 'hi' } },
    );
    const desktop = createDesktopShell({
      platform: 'linux',
      client: fake.client,
      readFile: async () => undefined,
      open: async (url) => void opened.push(url),
      reveal: async () => ({ ok: true }),
      openFile: async () => ({ ok: true }),
      focus: () => undefined,
    });
    await desktop.connect();
    await Bun.sleep(5);
    expect(fake.responses).toMatchObject([
      { id: 'a', result: { ok: true } },
      { id: 'b', result: { ok: false } },
      { id: 'c', result: { ok: false } },
    ]);
    await desktop.openFromPage('https://docs.example.com/notes/guide?lang=en');
    await desktop.openFromPage('https://elsewhere.example/notes/guide');
    expect(opened).toEqual([
      'https://docs.example.com/notes/x',
      'https://docs.example.com/notes/guide?lang=en',
    ]);
    desktop.close();
  });

  test('a refused page open opens nothing', async () => {
    const fake = fakeClient({ status: 'refused', reason: 'disabled', action: 'notes.docs' });
    const opened: string[] = [];
    const desktop = createDesktopShell({
      platform: 'windows',
      client: fake.client,
      readFile: async () => undefined,
      open: async (url) => void opened.push(url),
      reveal: async () => ({ ok: true }),
      openFile: async () => ({ ok: true }),
      focus: () => undefined,
    });
    await desktop.connect();
    await desktop.openFromPage('https://docs.example.com/notes/guide');
    expect(opened).toEqual([]);
    desktop.close();
  });

  test('a relayed notification shows its buttons, and a chosen one submits its reply', async () => {
    const fake = fakeClient(undefined);
    const choices: ((button: string) => void)[] = [];
    const shown: unknown[] = [];
    fake.relayed.push({
      id: 'n',
      instruction: {
        kind: 'notify',
        action: 'notes.remind',
        id: 'effect-1',
        category: 'reminder',
        title: 'Buy milk',
        buttons: [{ id: 'done', title: 'Done', handler: 'notes.reply', nonce: 'n'.repeat(43) }],
      },
    });
    const desktop = createDesktopShell({
      platform: 'macos',
      client: fake.client,
      readFile: async () => undefined,
      open: async () => undefined,
      reveal: async () => ({ ok: true }),
      openFile: async () => ({ ok: true }),
      notify: async (notification, choose) => {
        shown.push(notification);
        choices.push(choose);
        return { ok: true };
      },
      focus: () => undefined,
    });
    await desktop.connect();
    await Bun.sleep(5);
    expect(fake.responses).toMatchObject([{ id: 'n', result: { ok: true } }]);
    expect(shown).toEqual([
      {
        id: 'effect-1',
        category: 'reminder',
        title: 'Buy milk',
        buttons: [{ id: 'done', title: 'Done', handler: 'notes.reply', nonce: 'n'.repeat(43) }],
      },
    ]);
    choices[0]!('other');
    choices[0]!('done');
    await Bun.sleep(5);
    expect(fake.submitted).toEqual([
      { kind: 'reply', handler: 'notes.reply', nonce: 'n'.repeat(43), action: 'done' },
    ]);
    desktop.close();
  });
});

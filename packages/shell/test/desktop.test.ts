import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  buildCatalog,
  defineCapability,
  defineModule,
  jsonSchema,
  type CatalogOs,
  type OsActionOutcome,
  type OsHandler,
  type OsInstruction,
  type RawOsRequest,
} from '@agent-native/contracts';
import {
  createDesktopShell,
  desktopArguments,
  landingRequest,
  openActionFor,
  receivedArguments,
  type DesktopShellClient,
} from '../src/index';

const scheme = 'dev.example.notes';
const create = defineCapability({
  id: 'notes.create',
  kind: 'command',
  input: jsonSchema(z.strictObject({ title: z.string(), body: z.string() })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Note' },
  ui: { binding: 'notes.create' },
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
const os = buildCatalog([
  defineModule({
    id: 'notes',
    capabilities: [create],
    os: {
      handlers: [fromText],
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

describe('browser landing', () => {
  test('exactly one landing parameter becomes a request; anything else is ignored', () => {
    expect(landingRequest('?os=web%2Bnotes%3A%2F%2Fnotes%2Fn-1')).toEqual({
      kind: 'url',
      url: 'web+notes://notes/n-1',
    });
    expect(landingRequest('?os-shortcut=new-note')).toEqual({ kind: 'shortcut', id: 'new-note' });
    for (const search of ['', '?os=a&os=b', '?os=a&next=b', '?other=1', '?os-shortcut=New Note'])
      expect(landingRequest(search)).toBeUndefined();
    expect(landingRequest(`?os=${'a'.repeat(2049)}`)).toBeUndefined();
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
  const answers: unknown[] = [];
  const relayed: { id: string; instruction: OsInstruction }[] = [];
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
    answer: async (id, result) => void answers.push({ id, result }),
  };
  return { client, submitted, answers, relayed };
}

describe('desktop shell', () => {
  test('input before connect is buffered, and only declared text files are read', async () => {
    const fake = fakeClient(undefined);
    const read: string[] = [];
    let focused = 0;
    const desktop = createDesktopShell({
      platform: 'macos',
      client: fake.client,
      readText: async (path) => (read.push(path), 'milk'),
      open: async () => undefined,
      reveal: async () => ({ ok: true }),
      openFile: async () => ({ ok: true }),
      focus: () => focused++,
    });
    await desktop.receive({
      urls: [`${scheme}://notes/n-1`],
      paths: ['/x/Groceries.txt', '/x/a.pdf'],
    });
    expect(fake.submitted).toEqual([]);
    await desktop.connect();
    expect(read).toEqual(['/x/Groceries.txt']);
    expect(fake.submitted).toEqual([
      { kind: 'url', url: `${scheme}://notes/n-1` },
      { kind: 'file', name: 'Groceries.txt', text: 'milk' },
    ]);
    expect(focused).toBe(2);
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
      readText: async () => undefined,
      open: async (url) => void opened.push(url),
      reveal: async () => ({ ok: true }),
      openFile: async () => ({ ok: true }),
      focus: () => undefined,
    });
    await desktop.connect();
    await Bun.sleep(5);
    expect(fake.answers).toMatchObject([
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
      readText: async () => undefined,
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
});

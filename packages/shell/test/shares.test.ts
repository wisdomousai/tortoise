import { expect, test } from 'bun:test';
import { z } from 'zod';
import {
  blobRefSchema,
  buildCatalog,
  defineCapability,
  defineModule,
  jsonSchema,
  type OsHandler,
} from '@agent-native/contracts';
import {
  createMobileShell,
  launchRequest,
  nativeOsConfig,
  parseRawOsRequest,
  shareFileRequest,
  shareHandlerFor,
  webManifestOs,
} from '../src/index';

const create = defineCapability({
  id: 'note.create',
  kind: 'command',
  input: jsonSchema(
    z.strictObject({ body: z.string().optional(), scan: blobRefSchema.optional() }),
  ),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'create', resourceType: 'note' },
  ui: { binding: 'note.create' },
});
const handlers: OsHandler[] = [
  {
    id: 'note.from-shared-text',
    kind: 'share',
    description: 'Shared text.',
    accepts: { text: true, url: true },
    maxBytes: 200,
    target: { prepare: 'note.create', input: { body: '{text}' } },
  },
  {
    id: 'note.from-shared-scan',
    kind: 'share',
    description: 'A shared scan or photo.',
    accepts: { mediaTypes: ['application/pdf', 'image/png'] },
    maxBytes: 8,
    target: { prepare: 'note.create', input: { scan: '{blob}' } },
  },
];
const { os } = buildCatalog([
  defineModule({ id: 'notes', capabilities: [create], os: { handlers } }),
]);
const identity = { appId: 'dev.example.notes', scheme: 'dev.example.notes' };
const blob = { digest: `sha256:${'a'.repeat(64)}`, size: 3, mediaType: 'application/pdf' };

test('one share target per platform accepts what the share handlers accept together', () => {
  expect(webManifestOs(os, identity).share_target).toEqual({
    action: '/os/share',
    method: 'POST',
    enctype: 'multipart/form-data',
    params: {
      title: 'title',
      text: 'text',
      url: 'url',
      files: [{ name: 'file', accept: ['application/pdf', 'image/png'] }],
    },
  });
  const native = nativeOsConfig(os, identity);
  expect(native.plugins).toEqual([
    [
      'expo-sharing',
      {
        android: {
          enabled: true,
          singleShareMimeTypes: ['text/plain', 'application/pdf', 'image/png'],
        },
        ios: {
          enabled: true,
          activationRule: {
            supportsText: true,
            supportsWebUrlWithMaxCount: 1,
            supportsImageWithMaxCount: 1,
            supportsFileWithMaxCount: 1,
          },
        },
      },
    ],
  ]);
  // `expo-sharing` writes the SEND filter; the generated intent filters carry none.
  expect(native.android.intentFilters.map((filter) => filter.action)).not.toContain('SEND');
  expect(nativeOsConfig(undefined, identity).plugins).toEqual([]);
  expect(webManifestOs(undefined, identity)).toEqual({});
});

test('a shared file is read only for a handler that accepts its type, within its limit', async () => {
  expect(shareHandlerFor(os, 'APPLICATION/PDF')?.id).toBe('note.from-shared-scan');
  expect(shareHandlerFor(os, 'video/mp4')).toBeUndefined();
  expect(shareHandlerFor(os, undefined)).toBeUndefined();
  const handler = shareHandlerFor(os, 'application/pdf')!;
  const uploads: string[] = [];
  const upload = async (_bytes: Uint8Array, mediaType: string) => (uploads.push(mediaType), blob);
  expect(
    await shareFileRequest(handler, 'Receipt.pdf', 'Application/PDF', new Uint8Array(3), upload),
  ).toEqual({ kind: 'share', mediaType: 'application/pdf', blob, title: 'Receipt.pdf' });
  expect(
    await shareFileRequest(handler, 'Big.pdf', 'application/pdf', new Uint8Array(9), upload),
  ).toBeUndefined();
  expect(
    await shareFileRequest(
      handler,
      'x.pdf',
      'application/pdf',
      new Uint8Array(1),
      async () => undefined,
    ),
  ).toBeUndefined();
  expect(uploads).toEqual(['application/pdf']);
});

test('a claim is a one-use code, from a launch URL that carries only that code', () => {
  const code = 'abcdefghijklmnopqrstuv';
  expect(parseRawOsRequest({ kind: 'claim', code })).toEqual({ kind: 'claim', code });
  for (const value of [
    { kind: 'claim', code: 'short' },
    { kind: 'claim', code: `${code}!` },
    { kind: 'claim', code, extra: 1 },
  ])
    expect(() => parseRawOsRequest(value)).toThrow();
  expect(launchRequest(`?os-share=${code}`)).toEqual({ kind: 'claim', code });
  expect(launchRequest(`?os-share=${code}&os=x`)).toBeUndefined();
  expect(launchRequest('?os-share=short')).toBeUndefined();
});

test('a mobile shell without share bindings ignores share links and refuses share actions', async () => {
  const submitted: unknown[] = [];
  const shell = createMobileShell({
    platform: 'ios',
    scheme: 'dev.example.notes',
    declarations: () => os!,
    inspect: async () => undefined,
    read: async () => undefined,
    upload: async () => blob,
    submit: async (request) => (
      submitted.push(request),
      { status: 'refused', reason: 'no-handler' }
    ),
    deliver: () => undefined,
    open: async () => undefined,
  });
  await shell.receive('dev.example.notes://expo-sharing');
  // Without `shared` the link is an ordinary scheme link, which no link handler accepts.
  expect(submitted).toEqual([{ kind: 'url', url: 'dev.example.notes://expo-sharing' }]);
  expect(await shell.perform({ kind: 'share', action: 'notes.share', text: 'x' })).toEqual({
    ok: false,
    detail: 'share is not supported on this device',
  });
});

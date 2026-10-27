import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  blobRefSchema,
  buildCatalog,
  defineCapability,
  defineModule,
  jsonSchema,
  type BlobRef,
  type OsHandler,
} from '@agent-native/contracts';
import {
  fileHandlerFor,
  fileRequest,
  matchOsRequest,
  parseRawOsRequest,
  resolveTarget,
  type BlobUpload,
} from '../src/index';

const create = defineCapability({
  id: 'receipt.create',
  kind: 'command',
  input: jsonSchema(
    z.strictObject({
      title: z.string().max(80),
      notes: z.string().optional(),
      scan: blobRefSchema.optional(),
    }),
  ),
  output: jsonSchema(z.string()),
  permission: { action: 'create', resourceType: 'receipt' },
  ui: { binding: 'receipt.create' },
  blobs: { maxBytes: 4096, mediaTypes: ['image/png', 'application/pdf'] },
});
const note: OsHandler = {
  id: 'receipt.from-note',
  kind: 'file',
  description: 'A receipt from a note.',
  types: [{ extensions: ['txt'], mediaTypes: ['text/plain'], description: 'Note' }],
  role: 'viewer',
  payload: 'text',
  maxBytes: 64,
  target: { prepare: 'receipt.create', input: { title: '{file.stem}', notes: '{file.text}' } },
};
const scan: OsHandler = {
  id: 'receipt.from-scan',
  kind: 'file',
  description: 'A receipt from a scan.',
  types: [
    { extensions: ['png'], mediaTypes: ['image/png'], description: 'PNG image' },
    { extensions: ['pdf'], mediaTypes: ['application/pdf'], description: 'PDF document' },
  ],
  role: 'viewer',
  payload: 'blob',
  maxBytes: 4096,
  target: { prepare: 'receipt.create', input: { title: '{file.stem}', scan: '{file.blob}' } },
};
const handlers = [note, scan];
const catalog = buildCatalog([
  defineModule({ id: 'receipts', capabilities: [create], os: { handlers } }),
]);
const os = catalog.os!;
const ref = (size: number, mediaType: string): BlobRef => ({
  digest: `sha256:${'b'.repeat(64)}`,
  size,
  mediaType,
});
const match = (value: unknown) =>
  matchOsRequest(handlers, parseRawOsRequest(value), { schemes: ['dev.example.receipts'] });

describe('blob file requests', () => {
  test('a staged blob prefills the form as its reference, with the file name as provenance', () => {
    const blob = { ...ref(1200, 'image/png') };
    const found = match({ kind: 'file', name: 'Lunch.png', mediaType: 'image/png', blob })!;
    expect(resolveTarget(found, catalog)).toEqual({
      delivery: {
        type: 'prepare',
        operation: 'receipt.create',
        input: { title: 'Lunch', scan: blob },
        provenance: { kind: 'file', handler: 'receipt.from-scan', label: 'Lunch.png' },
      },
    });
  });

  test('a blob must be within the limit and of a media type the handler declares', () => {
    expect(() => match({ kind: 'file', name: 'a.png', blob: ref(4097, 'image/png') })).toThrow(
      'larger',
    );
    expect(() => match({ kind: 'file', name: 'a.png', text: 'not a blob' })).toThrow('needs');
    // Matched by extension, stored as something the handler never declared.
    expect(() => match({ kind: 'file', name: 'a.png', blob: ref(10, 'text/html') })).toThrow(
      'media type',
    );
    // Reported as one declared type, stored as another.
    expect(() =>
      match({
        kind: 'file',
        name: 'a.png',
        mediaType: 'image/png',
        blob: ref(10, 'application/pdf'),
      }),
    ).toThrow('media type');
  });
});

describe('file request building', () => {
  const uploads: { size: number; mediaType: string }[] = [];
  const upload: BlobUpload = async (bytes, mediaType) => {
    uploads.push({ size: bytes.byteLength, mediaType });
    return ref(bytes.byteLength, mediaType);
  };
  const bytes = (text: string) => new TextEncoder().encode(text);

  test('the handler is found by extension or reported media type, as the shell port matches', () => {
    expect(fileHandlerFor(os, 'Notes.TXT')?.id).toBe('receipt.from-note');
    expect(fileHandlerFor(os, 'scan', 'application/pdf')?.id).toBe('receipt.from-scan');
    expect(fileHandlerFor(os, 'movie.mp4', 'video/mp4')).toBeUndefined();
    expect(fileHandlerFor(os, '.png')).toBeUndefined();
  });

  test('text is sent inline; a blob is uploaded first as a declared media type', async () => {
    const noteHandler = fileHandlerFor(os, 'a.txt')!;
    const scanHandler = fileHandlerFor(os, 'a.pdf')!;
    expect(await fileRequest(noteHandler, 'a.txt', bytes('milk'), upload)).toEqual({
      kind: 'file',
      name: 'a.txt',
      text: 'milk',
    });
    expect(await fileRequest(noteHandler, '42', bytes('milk'), upload, 'text/plain')).toEqual({
      kind: 'file',
      name: '42',
      text: 'milk',
      mediaType: 'text/plain',
    });
    expect(await fileRequest(noteHandler, 'a.txt', new Uint8Array([0xff]), upload)).toBeUndefined();
    expect(await fileRequest(noteHandler, 'a.txt', bytes('x'.repeat(65)), upload)).toBeUndefined();
    expect(uploads).toEqual([]);

    expect(await fileRequest(scanHandler, 'Lunch.pdf', bytes('%PDF'), upload)).toEqual({
      kind: 'file',
      name: 'Lunch.pdf',
      mediaType: 'application/pdf',
      blob: ref(4, 'application/pdf'),
    });
    // A reported type the handler does not declare falls back to the one for the extension.
    await fileRequest(scanHandler, 'b.png', bytes('png'), upload, 'application/octet-stream');
    expect(uploads).toEqual([
      { size: 4, mediaType: 'application/pdf' },
      { size: 3, mediaType: 'image/png' },
    ]);
    expect(await fileRequest(scanHandler, 'c.png', new Uint8Array(4097), upload)).toBeUndefined();
    expect(
      await fileRequest(scanHandler, 'c.png', bytes('x'), async () => undefined),
    ).toBeUndefined();
    expect(uploads).toHaveLength(2);
  });
});

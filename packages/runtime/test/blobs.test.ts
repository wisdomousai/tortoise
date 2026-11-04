import { describe, expect, test } from 'bun:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { z } from 'zod';
import {
  ApplicationError,
  blobRefSchema,
  buildCatalog,
  defineCapability,
  defineModule,
  jsonSchema,
  type AuditRecord,
  type BlobRef,
} from '@tortoise/contracts';
import {
  createApplication,
  createHandlerFactory,
  createMemoryBlobStore,
  createMemoryStorage,
  type ExecutionContext,
} from '../src/index';

const limits = { maxBytes: 1024, mediaTypes: ['image/jpeg'] };
const attach = defineCapability({
  id: 'photo.attach',
  kind: 'command',
  input: jsonSchema(
    z.strictObject({
      capture: z.string(),
      photo: blobRefSchema,
      undeclared: z.boolean().optional(),
      fail: z.boolean().optional(),
    }),
  ),
  output: jsonSchema(z.strictObject({ capture: z.string() })),
  permission: { action: 'update', resourceType: 'capture' },
  ui: { exception: 'test fixture' },
  blobs: limits,
});
const detach = defineCapability({
  id: 'photo.detach',
  kind: 'command',
  input: jsonSchema(z.strictObject({ capture: z.string() })),
  output: jsonSchema(z.strictObject({ capture: z.string() })),
  permission: { action: 'update', resourceType: 'capture' },
  ui: { exception: 'test fixture' },
});
const share = defineCapability({
  id: 'capture.share',
  kind: 'command',
  input: jsonSchema(z.strictObject({ capture: z.string(), readers: z.array(z.string()) })),
  output: jsonSchema(z.strictObject({ capture: z.string() })),
  permission: { action: 'share', resourceType: 'capture' },
  ui: { exception: 'test fixture' },
});
const file = defineCapability({
  id: 'photo.file',
  kind: 'command',
  input: jsonSchema(z.strictObject({ capture: z.string() })),
  output: jsonSchema(z.strictObject({ effectId: z.string() })),
  permission: { action: 'file', resourceType: 'capture' },
  ui: { exception: 'test fixture' },
  integration: { target: 'eam', delivery: 'outbox' },
});
const module = defineModule({
  id: 'captures',
  capabilities: [attach, detach, share, file],
  requirements: {
    network: [
      {
        id: 'eam-api',
        purpose: 'Test asset register',
        direction: 'egress',
        scope: 'local',
        protocol: 'https',
        targets: ['eam'],
        dataClasses: ['test-record'],
        availability: 'required',
        offline: 'queue',
      },
    ],
  },
});

interface Capture {
  readonly owner: string;
  readers: string[];
  photo?: string;
}
type State = { captures: Record<string, Capture> };

const owner: ExecutionContext = { workspaceId: 'w', principalId: 'inspector' };
const reviewer: ExecutionContext = { workspaceId: 'w', principalId: 'reviewer' };
const stranger: ExecutionContext = { workspaceId: 'w', principalId: 'stranger' };
const grace = 60_000;

/** `store` stands for the blob store a restarted instance opens again. */
function fixture(options: { store?: ReturnType<typeof createMemoryBlobStore> } = {}) {
  let now = 1_000_000;
  const clock = () => now;
  const storage = createMemoryStorage<State>({ captures: {} });
  const store = options.store ?? createMemoryBlobStore(clock);
  const audit: AuditRecord[] = [];
  const bind = createHandlerFactory<State, {}>();
  let effects = 0;
  const app = createApplication({
    modules: [module],
    storage,
    services: {},
    now: clock,
    blobStore: (workspaceId) => (workspaceId === 'w' ? store : undefined),
    blobGraceMs: grace,
    newEffectId: () => `effect-${++effects}`,
    eventLog: {
      mode: { commands: 'required', queries: 'required', egress: 'required' },
      append: async (records) => {
        audit.push(...records);
        return [];
      },
    },
    authorization: {
      authorize: () => ({ allowed: true }),
      canReadEvent: ({ event, context, state }) => {
        const capture = state.captures[event.resource.replace(/^capture:/, '')];
        return (
          !capture ||
          capture.owner === context.principalId ||
          capture.readers.includes(context.principalId)
        );
      },
    },
    handlers: [
      bind(attach, (input, ctx) => {
        const existing = ctx.state.captures[input.capture];
        ctx.state.captures[input.capture] = {
          owner: existing?.owner ?? ctx.context.principalId,
          readers: existing?.readers ?? [],
          photo: input.photo.digest,
        };
        if (!input.undeclared) ctx.change(`capture:${input.capture}`);
        ctx.attach(`capture:${input.capture}`, input.photo);
        if (input.fail) throw new ApplicationError('INVALID_INPUT', 'Rejected by the handler');
        return { capture: input.capture };
      }),
      bind(detach, (input, ctx) => {
        const capture = ctx.state.captures[input.capture]!;
        ctx.detach(`capture:${input.capture}`, capture.photo!);
        delete capture.photo;
        ctx.change(`capture:${input.capture}`);
        return { capture: input.capture };
      }),
      bind(share, (input, ctx) => {
        ctx.state.captures[input.capture]!.readers = input.readers;
        ctx.change(`capture:${input.capture}`);
        return { capture: input.capture };
      }),
      bind(file, (input, ctx) => {
        const capture = ctx.state.captures[input.capture]!;
        ctx.change(`capture:${input.capture}`);
        const effectId = ctx.enqueue({
          target: 'eam',
          type: 'photo.file',
          resource: `capture:${input.capture}`,
          payload: { photo: capture.photo! },
        });
        return { effectId };
      }),
    ],
  });
  let keys = 0;
  const invoke = (operation: string, input: unknown, context = owner) =>
    app.invokeRaw({ operation, input, idempotencyKey: `key-${++keys}` }, context);
  const snapshot = () => storage.read('w', async (value) => structuredClone(value));
  return {
    app,
    store,
    audit,
    invoke,
    snapshot,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const photo = (fill: number, size = 600) => new Uint8Array(size).fill(fill);
const digestOf = (data: Uint8Array) => `sha256:${bytesToHex(sha256(data))}`;
const code = (error: unknown) => (error as ApplicationError).code;

describe('blob references', () => {
  test('an uploaded blob attaches and only its reference enters the snapshot', async () => {
    const { app, invoke, snapshot } = fixture();
    const data = photo(1);
    const ref = await app.putBlob(data, 'image/jpeg', owner);
    expect(ref).toEqual({ digest: digestOf(data), size: 600, mediaType: 'image/jpeg' });
    await invoke('photo.attach', { capture: 'c1', photo: ref });
    const stored = await snapshot();
    expect(stored.blobs).toEqual({
      [ref.digest]: { size: 600, mediaType: 'image/jpeg', resources: ['capture:c1'] },
    });
    expect(JSON.stringify(stored).length).toBeLessThan(2_000);
  });

  test('reading follows the resources that reference the blob, including revocation', async () => {
    const { app, invoke } = fixture();
    const data = photo(2);
    const ref = await app.putBlob(data, 'image/jpeg', owner);
    await invoke('photo.attach', { capture: 'c1', photo: ref });
    expect((await app.readBlob(ref.digest, owner)).data).toEqual(data);
    expect(await app.readBlob(ref.digest, reviewer).catch(code)).toBe('NOT_FOUND');
    await invoke('capture.share', { capture: 'c1', readers: ['reviewer'] });
    expect((await app.readBlob(ref.digest, reviewer)).ref).toEqual(ref);
    const scoped = {
      ...reviewer,
      grant: { operations: ['photo.attach'], resources: ['capture:other'] },
    };
    expect(await app.readBlob(ref.digest, scoped).catch(code)).toBe('NOT_FOUND');
    await invoke('capture.share', { capture: 'c1', readers: [] });
    expect(await app.readBlob(ref.digest, reviewer).catch(code)).toBe('NOT_FOUND');
    expect(await app.readBlob('sha256:unknown', owner).catch(code)).toBe('NOT_FOUND');
  });

  test('attaching needs the caller own recent upload or read access to the blob', async () => {
    const { app, invoke, advance } = fixture();
    const ref = await app.putBlob(photo(3), 'image/jpeg', owner);
    await invoke('photo.attach', { capture: 'c1', photo: ref });
    expect(await invoke('photo.attach', { capture: 's1', photo: ref }, stranger).catch(code)).toBe(
      'INVALID_INPUT',
    );
    await invoke('capture.share', { capture: 'c1', readers: ['reviewer'] });
    await invoke('photo.attach', { capture: 'r1', photo: ref }, reviewer);
    const wrongSize = { ...ref, size: 599 };
    expect(await invoke('photo.attach', { capture: 'c2', photo: wrongSize }).catch(code)).toBe(
      'INVALID_INPUT',
    );
    const late = await app.putBlob(photo(4), 'image/jpeg', owner);
    advance(grace + 1);
    expect(await invoke('photo.attach', { capture: 'c3', photo: late }).catch(code)).toBe(
      'INVALID_INPUT',
    );
  });

  test('an upload stays attachable by its uploader after a restart, within the grace period', async () => {
    const before = fixture();
    const ref = await before.app.putBlob(photo(12), 'image/jpeg', owner);
    const after = fixture({ store: before.store });
    expect(
      await after.invoke('photo.attach', { capture: 's1', photo: ref }, stranger).catch(code),
    ).toBe('INVALID_INPUT');
    await after.invoke('photo.attach', { capture: 'c1', photo: ref });
    const late = await before.app.putBlob(photo(13), 'image/jpeg', owner);
    const later = fixture({ store: before.store });
    later.advance(grace + 1);
    expect(await later.invoke('photo.attach', { capture: 'c2', photo: late }).catch(code)).toBe(
      'INVALID_INPUT',
    );
  });

  test('uploads and attachments stay within declared limits', async () => {
    const { app, invoke } = fixture();
    expect(await app.putBlob(photo(5), 'text/plain', owner).catch(code)).toBe('INVALID_INPUT');
    expect(await app.putBlob(photo(5, 1025), 'image/jpeg', owner).catch(code)).toBe(
      'INVALID_INPUT',
    );
    const delegated = { ...owner, grant: { operations: ['capture.share'] } };
    expect(await app.putBlob(photo(5), 'image/jpeg', delegated).catch(code)).toBe('INVALID_INPUT');
    const ref = await app.putBlob(photo(5), 'image/jpeg', owner);
    expect(
      await invoke('photo.attach', { capture: 'c1', photo: ref, undeclared: true }).catch(code),
    ).toBe('INTERNAL');
    const oversized: BlobRef = { ...ref, size: 2_000 };
    expect(await invoke('photo.attach', { capture: 'c1', photo: oversized }).catch(code)).toBe(
      'INVALID_INPUT',
    );
    expect(() =>
      buildCatalog([
        defineModule({
          id: 'bad',
          capabilities: [
            defineCapability({ ...attach, id: 'photo.list', kind: 'query', blobs: limits }),
          ],
        }),
      ]),
    ).toThrow('Only commands attach blobs');
  });

  test('a rejected command leaves only the upload, which is swept after the grace period', async () => {
    const { app, store, invoke, snapshot, advance } = fixture();
    const ref = await app.putBlob(photo(6), 'image/jpeg', owner);
    expect(
      await invoke('photo.attach', { capture: 'c1', photo: ref, fail: true }).catch(code),
    ).toBe('INVALID_INPUT');
    expect((await snapshot()).blobs).toEqual({});
    expect(await app.sweepBlobs('w')).toEqual({ removed: 0 });
    advance(grace + 1);
    expect(await app.sweepBlobs('w')).toEqual({ removed: 1 });
    expect(await store.list()).toEqual([]);
  });

  test('sweeping keeps referenced and freshly stored blobs and removes detached ones', async () => {
    const { app, store, invoke, snapshot, advance } = fixture();
    const data = photo(7);
    const ref = await app.putBlob(data, 'image/jpeg', owner);
    await invoke('photo.attach', { capture: 'c1', photo: ref });
    await invoke('photo.attach', { capture: 'c2', photo: ref });
    await invoke('photo.detach', { capture: 'c1' });
    expect((await snapshot()).blobs[ref.digest]?.resources).toEqual(['capture:c2']);
    advance(grace + 1);
    expect(await app.sweepBlobs('w')).toEqual({ removed: 0 });
    await invoke('photo.detach', { capture: 'c2' });
    expect((await snapshot()).blobs).toEqual({});
    await app.putBlob(data, 'image/jpeg', owner);
    expect(await app.sweepBlobs('w')).toEqual({ removed: 0 });
    advance(grace + 1);
    expect(await app.sweepBlobs('w')).toEqual({ removed: 1 });
    expect(await store.list()).toEqual([]);
  });

  test('a connector reads the blobs attached to the resource an effect reports on', async () => {
    const { app, invoke } = fixture();
    const data = photo(8);
    const ref = await app.putBlob(data, 'image/jpeg', owner);
    const other = await app.putBlob(photo(9), 'image/jpeg', owner);
    await invoke('photo.attach', { capture: 'c1', photo: ref });
    await invoke('photo.attach', { capture: 'c2', photo: other });
    const receipt = await invoke('photo.file', { capture: 'c1' });
    const { effectId } = receipt.result as { effectId: string };
    expect((await app.readEffectBlob('w', effectId, ref.digest))?.data).toEqual(data);
    expect(await app.readEffectBlob('w', effectId, other.digest)).toBeUndefined();
    expect(await app.readEffectBlob('w', 'effect-unknown', ref.digest)).toBeUndefined();
  });

  test('uploads, reads and refusals are audited by digest', async () => {
    const { app, audit, invoke } = fixture();
    const ref = await app.putBlob(photo(10), 'image/jpeg', owner);
    await invoke('photo.attach', { capture: 'c1', photo: ref });
    await app.readBlob(ref.digest, owner);
    await app.readBlob(ref.digest, stranger).catch(() => undefined);
    const blobEvents = audit
      .filter((record) => record.kind.startsWith('blob.'))
      .map((record) => [record.kind, record.actor?.principalId, record.data?.digest]);
    expect(blobEvents).toEqual([
      ['blob.stored', 'inspector', ref.digest],
      ['blob.read', 'inspector', ref.digest],
      ['blob.denied', 'stranger', ref.digest],
    ]);
  });

  test('without a blob store, uploads are unavailable', async () => {
    const { app } = fixture();
    const elsewhere = { workspaceId: 'other', principalId: 'inspector' };
    expect(await app.putBlob(photo(11), 'image/jpeg', elsewhere).catch(code)).toBe('UNAVAILABLE');
  });
});

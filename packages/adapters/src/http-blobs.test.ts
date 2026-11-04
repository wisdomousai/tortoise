import { expect, test } from 'bun:test';
import { z } from 'zod';
import { createHttpTransport } from '@tortoise/client';
import {
  ApplicationError,
  blobRefSchema,
  defineCapability,
  defineModule,
  jsonSchema,
} from '@tortoise/contracts';
import {
  createApplication,
  createHandlerFactory,
  createMemoryBlobStore,
  createMemoryStorage,
} from '@tortoise/runtime';
import { createDirectTransport } from './direct-transport';
import { createHttpHandler } from './http';
import { Sessions } from './http/sessions';

const attach = defineCapability({
  id: 'photo.attach',
  kind: 'command',
  input: jsonSchema(z.strictObject({ capture: z.string(), photo: blobRefSchema })),
  output: jsonSchema(z.strictObject({ capture: z.string() })),
  permission: { action: 'update', resourceType: 'capture' },
  ui: { exception: 'test fixture' },
  blobs: { maxBytes: 64, mediaTypes: ['image/png', 'image/svg+xml'] },
});
type State = { owners: Record<string, string> };

function fixture() {
  const bind = createHandlerFactory<State, {}>();
  const application = createApplication({
    modules: [defineModule({ id: 'captures', capabilities: [attach] })],
    storage: createMemoryStorage<State>({ owners: {} }),
    services: {},
    blobStore: () => store,
    authorization: {
      authorize: () => ({ allowed: true }),
      canReadEvent: ({ event, context, state }) =>
        state.owners[event.resource] === context.principalId,
    },
    handlers: [
      bind(attach, (input, ctx) => {
        ctx.state.owners[`capture:${input.capture}`] = ctx.context.principalId;
        ctx.change(`capture:${input.capture}`);
        ctx.attach(`capture:${input.capture}`, input.photo);
        return { capture: input.capture };
      }),
    ],
  });
  const store = createMemoryBlobStore();
  const origin = 'http://127.0.0.1:4100';
  const sessions = new Sessions();
  const localUser = sessions.create({ workspaceId: 'w', principalId: 'local-user' });
  const other = sessions.create({ workspaceId: 'w', principalId: 'other' });
  const handler = createHttpHandler({ application, sessions, origin: () => origin });
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(
      new Request(String(input), {
        ...init,
        headers: { ...(init?.headers as Record<string, string>), host: '127.0.0.1:4100' },
      }),
    )) as typeof globalThis.fetch;
  const client = (token: string) => createHttpTransport({ baseUrl: origin, token, fetch });
  return { application, handler, origin, localUser, other, client };
}

const code = (error: unknown) => (error as ApplicationError).code;

test('a blob uploaded over HTTP attaches and reads back only for its readers', async () => {
  const { client, localUser, other } = fixture();
  const data = new Uint8Array([137, 80, 78, 71]);
  const transport = client(localUser.token);
  const ref = await transport.blobs!.put(data, 'image/png');
  expect(ref.size).toBe(4);
  await transport.command('photo.attach', { capture: 'c1', photo: ref });
  const read = await transport.blobs!.get(ref.digest);
  expect(read.data).toEqual(data);
  expect(read.ref.mediaType).toBe('image/png');
  expect(await client(other.token).blobs!.get(ref.digest).catch(code)).toBe('NOT_FOUND');
});

test('a downloaded blob is sandboxed, typed and never cached', async () => {
  const { handler, client, localUser, origin } = fixture();
  const svg = new TextEncoder().encode('<svg onload="alert(1)"/>');
  const transport = client(localUser.token);
  const ref = await transport.blobs!.put(svg, 'image/svg+xml');
  await transport.command('photo.attach', { capture: 'c1', photo: ref });
  const response = await handler(
    new Request(`${origin}/api/v1/blobs/${encodeURIComponent(ref.digest)}`, {
      headers: { host: '127.0.0.1:4100', authorization: `Bearer ${localUser.token}` },
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/svg+xml');
  expect(response.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('cache-control')).toBe('no-store');
});

test('uploads beyond the largest declared size or of undeclared types are refused', async () => {
  const { client, localUser } = fixture();
  const transport = client(localUser.token);
  expect(await transport.blobs!.put(new Uint8Array(65), 'image/png').catch(code)).toBe(
    'INVALID_INPUT',
  );
  expect(await transport.blobs!.put(new Uint8Array(4), 'text/html').catch(code)).toBe(
    'INVALID_INPUT',
  );
  expect(await transport.blobs!.put(new Uint8Array(4), 'not a type').catch(code)).toBe(
    'INVALID_INPUT',
  );
});

test('the direct transport stores and reads blobs under the launcher context', async () => {
  const { application } = fixture();
  const transport = createDirectTransport(application, {
    workspaceId: 'w',
    principalId: 'local-user',
  });
  const data = new Uint8Array([1, 2, 3]);
  const ref = await transport.blobs!.put(data, 'image/png');
  await transport.command(
    'photo.attach',
    { capture: 'c1', photo: ref },
    { idempotencyKey: 'attach-1' },
  );
  expect((await transport.blobs!.get(ref.digest)).data).toEqual(data);
});

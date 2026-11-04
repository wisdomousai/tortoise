import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { ApplicationError, defineDataProvider, defineModule } from '@tortoise/contracts';
import { createMemoryEventLog } from '@tortoise/event-log';
import {
  createApplication,
  createHandlerFactory,
  createMemoryStorage,
  createRemoteQueryFactory,
  type RemoteSource,
  type SourceCall,
  type SourceRequest,
} from '../src/index';

const accounts = defineDataProvider({
  id: 'sor.account',
  target: 'sor',
  identity: 'caller-or-service',
  resourceType: 'Account',
  query: z.strictObject({ q: z.string().max(100) }),
  item: z.strictObject({
    externalId: z.string(),
    name: z.string(),
    region: z.string(),
    held: z.boolean(),
  }),
  descriptions: { search: 'Search accounts.', lookup: 'Read one account.' },
});
const module = defineModule({
  id: 'accounts',
  capabilities: accounts.capabilities,
  requirements: {
    network: [
      {
        id: 'sor-api',
        purpose: 'Test system of record',
        direction: 'outbound',
        scope: 'local',
        protocol: 'https',
        reads: ['sor'],
        dataClasses: ['account'],
        availability: 'optional',
        offline: 'degrade',
      },
    ],
  },
});
type State = { held: string[]; regions: string[] };
const caller = { workspaceId: 'w', principalId: 'alice' };
const found = [
  { id: 'A1', name: 'Acme', region: 'north' },
  { id: 'A2', name: 'Apex', region: 'south' },
];

function fixture(
  options: {
    source?: RemoteSource | null;
    deny?: () => boolean;
    deadlineMs?: number;
    mutate?: boolean;
  } = {},
) {
  const storage = createMemoryStorage<State>({ held: ['A1'], regions: ['north', 'south'] });
  const remote = createRemoteQueryFactory<State, {}>();
  const calls: { request: SourceRequest; call: SourceCall }[] = [];
  const source: RemoteSource = options.source ?? {
    async search(request, call) {
      calls.push({ request, call });
      return { items: found, identity: 'caller' };
    },
  };
  const toItem = (item: unknown, state: State) => {
    const account = item as (typeof found)[number];
    return {
      externalId: account.id,
      name: account.name,
      region: account.region,
      held: state.held.includes(account.id),
    };
  };
  const log = createMemoryEventLog();
  const app = createApplication({
    modules: [module],
    storage,
    services: {},
    eventLog: log,
    ...(options.source === null ? {} : { sources: { sor: source } }),
    ...(options.deadlineMs ? { remoteDeadlineMs: options.deadlineMs } : {}),
    authorization: {
      authorize: () => ({ allowed: !options.deny?.() }),
      // Row scoping: only regions the caller holds are readable, whatever the source returned.
      projectOutput: ({ output, state }) => {
        const result = output as { items: { region: string }[] };
        return {
          ...result,
          items: result.items.filter((item) => state.regions.includes(item.region)),
        };
      },
      canReadEvent: () => true,
    },
    handlers: [
      remote(accounts.search, {
        request: (input, ctx) => {
          if (options.mutate) ctx.state.held.push('X');
          const query = { text: input.q, exclude: ctx.state.held.length };
          return input.cursor ? { ...query, cursor: input.cursor } : query;
        },
        item: (item, ctx) => toItem(item, ctx.state),
      }),
      remote(accounts.lookup, {
        request: (input) => ({ id: input.externalId }),
        item: (item, ctx) => toItem(item, ctx.state),
      }),
    ],
  });
  return { app, calls, storage, log };
}
const search = (q = 'a') => ({ operation: 'sor.account.search', input: { q } });

describe('remote query', () => {
  test('authorizes, asks the source outside the snapshot, maps and returns its status', async () => {
    const { app, calls, log } = fixture();
    const result = await app.queryRaw(search('ac'), caller);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.request).toEqual({
      operation: 'sor.account.search',
      query: { text: 'ac', exclude: 1 },
    });
    expect(calls[0]!.call.context).toBe(caller);
    expect(calls[0]!.call.identity).toBe('caller-or-service');
    const data = result.data as { items: { externalId: string; held: boolean }[]; source: object };
    expect(data.items.map((item) => [item.externalId, item.held])).toEqual([
      ['A1', true],
      ['A2', false],
    ]);
    expect(data.source).toMatchObject({ target: 'sor', status: 'ok', identity: 'caller' });
    // The audit names the target and counts; it never records the query text or items.
    const executed = log.events().find((event) => event.kind === 'query.executed')!;
    expect(executed.data).toEqual({
      target: 'sor',
      status: 'ok',
      identity: 'caller',
      items: 2,
      more: false,
    });
    expect(JSON.stringify(log.events())).not.toContain('Acme');
  });

  test('the source pages: the cursor reaches it in the request and its next cursor comes back', async () => {
    const pages: Record<string, { items: typeof found; next?: string }> = {
      '': { items: [found[0]!], next: 'p2' },
      p2: { items: [found[1]!] },
    };
    const sent: unknown[] = [];
    const { app, storage } = fixture({
      source: {
        async search(request) {
          sent.push(request.query);
          const { cursor } = request.query as { cursor?: string };
          return { ...pages[cursor ?? '']!, identity: 'caller' };
        },
      },
    });
    // The first page's only row is outside the caller's regions: an empty page that still has a
    // next page, which is why only a missing `next` ends the list.
    await storage.transact('w', async (snapshot) => {
      snapshot.state.regions = ['south'];
    });
    const first = await app.queryRaw(search(), caller);
    expect(first.data).toMatchObject({ items: [], next: 'p2' });
    const second = await app.queryRaw(
      { operation: 'sor.account.search', input: { q: 'a', cursor: 'p2' } },
      caller,
    );
    expect(second.data).toMatchObject({ items: [{ externalId: 'A2' }] });
    expect((second.data as { next?: string }).next).toBeUndefined();
    expect(sent).toEqual([
      { text: 'a', exclude: 1 },
      { text: 'a', exclude: 1, cursor: 'p2' },
    ]);

    const malformed = fixture({
      source: { search: async () => ({ items: [], next: 'x'.repeat(513), identity: 'caller' }) },
    });
    expect((await malformed.app.queryRaw(search(), caller)).data).toMatchObject({
      items: [],
      source: { status: 'unavailable', message: 'Source result was malformed' },
    });
  });

  test('a denied caller never reaches the source', async () => {
    const { app, calls } = fixture({ deny: () => true });
    await expect(app.queryRaw(search(), caller)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(calls).toHaveLength(0);
  });

  test('a revocation while the source responds drops the result', async () => {
    let revoked = false;
    const { app } = fixture({
      deny: () => revoked,
      source: {
        async search() {
          revoked = true;
          return { items: found, identity: 'caller' };
        },
      },
    });
    await expect(app.queryRaw(search(), caller)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('local policy projects the rows the source returned', async () => {
    const { app, storage } = fixture();
    await storage.transact('w', async (snapshot) => {
      snapshot.state.regions = ['south'];
    });
    const result = await app.queryRaw(search(), caller);
    expect((result.data as { items: { externalId: string }[] }).items).toEqual([
      expect.objectContaining({ externalId: 'A2' }),
    ]);
  });

  test('a service credential is refused for a caller-only query', async () => {
    const callerOnly = defineDataProvider({
      id: 'sor.secret',
      target: 'sor',
      identity: 'caller',
      resourceType: 'Account',
      query: z.strictObject({ q: z.string() }),
      item: z.strictObject({ externalId: z.string() }),
      descriptions: { search: 'Search.', lookup: 'Lookup.' },
    });
    const remote = createRemoteQueryFactory<{}, {}>();
    const app = createApplication({
      modules: [defineModule({ ...module, id: 'secret', capabilities: callerOnly.capabilities })],
      storage: createMemoryStorage<{}>({}),
      services: {},
      sources: { sor: { search: async () => ({ items: [], identity: 'service' }) } },
      authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
      handlers: [callerOnly.search, callerOnly.lookup].map((capability) =>
        remote(capability, { request: () => ({}), item: () => undefined }),
      ),
    });
    await expect(
      app.queryRaw({ operation: 'sor.secret.search', input: { q: '' } }, caller),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('an unreachable source is a status, and provider error text never reaches the caller', async () => {
    const failing = fixture({
      source: {
        search: async () => {
          throw new Error('ECONNREFUSED https://sor.internal token=abc');
        },
      },
    });
    const result = await failing.app.queryRaw(search(), caller);
    expect(result.data).toMatchObject({
      items: [],
      source: { target: 'sor', status: 'unavailable', message: 'Source unavailable' },
    });
    expect(JSON.stringify(result)).not.toContain('token');

    const safe = fixture({
      source: {
        search: async () => {
          throw new ApplicationError('UNAVAILABLE', 'CRM maintenance until 14:00');
        },
      },
    });
    expect((await safe.app.queryRaw(search(), caller)).data).toMatchObject({
      source: { status: 'unavailable', message: 'CRM maintenance until 14:00' },
    });

    const unbound = fixture({ source: null });
    expect((await unbound.app.queryRaw(search(), caller)).data).toMatchObject({
      source: { status: 'unavailable', message: 'Source is not connected' },
    });
  });

  test('a FORBIDDEN from the source rejects the query instead of returning an empty result', async () => {
    const { app } = fixture({
      source: {
        search: async () => {
          throw new ApplicationError('FORBIDDEN', 'Connect your sor account');
        },
      },
    });
    await expect(app.queryRaw(search(), caller)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Connect your sor account',
    });
  });

  test('the deadline and caller cancellation reach the source signal', async () => {
    const seen: AbortSignal[] = [];
    const hanging: RemoteSource = {
      search: (_request, call) =>
        new Promise((_resolve, reject) => {
          seen.push(call.signal);
          call.signal.addEventListener('abort', () => reject(call.signal.reason), { once: true });
        }),
    };
    const slow = fixture({ source: hanging, deadlineMs: 20 });
    expect((await slow.app.queryRaw(search(), caller)).data).toMatchObject({
      source: { status: 'unavailable', message: 'Source did not respond in time' },
    });
    expect(seen[0]!.aborted).toBe(true);

    const controller = new AbortController();
    const cancelled = fixture({ source: hanging });
    const pending = cancelled.app.queryRaw(search(), { ...caller, signal: controller.signal });
    await Bun.sleep(5);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  test('handlers stay pure: mutating state in request fails', async () => {
    const { app, calls } = fixture({ mutate: true });
    await expect(app.queryRaw(search(), caller)).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(calls).toHaveLength(0);
  });

  test('declaration and handler shape must agree', () => {
    const bind = createHandlerFactory<{}, {}>();
    expect(() =>
      createApplication({
        modules: [module],
        storage: createMemoryStorage<{}>({}),
        services: {},
        authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
        handlers: [
          bind(accounts.search, () => ({ items: [], source: {} as never })),
          bind(accounts.lookup, () => ({ items: [], source: {} as never })),
        ],
      }),
    ).toThrow('Remote declaration and handler disagree: sor.account.search');
  });
});

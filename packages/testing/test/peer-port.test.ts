import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { createHttpHandler } from '@tortoise/adapters/http';
import { Sessions } from '@tortoise/adapters/http/sessions';
import {
  ApplicationError,
  defineCapability,
  defineModule,
  jsonSchema,
  type ErrorEnvelope,
} from '@tortoise/contracts';
import {
  createPeerPort,
  DeliveryFailure,
  DeliveryUncertain,
  type PeerClient,
} from '@tortoise/integration';
import { createApplication, createHandlerFactory, createMemoryStorage } from '@tortoise/runtime';
import { conformanceEffect, connectorConformance, type ConnectorHarness } from '../src/connectors';

const receive = defineCapability({
  id: 'parcel.receive',
  kind: 'command',
  input: jsonSchema(z.strictObject({ ref: z.string(), refuse: z.boolean().optional() })),
  output: jsonSchema(z.strictObject({ id: z.string() })),
  permission: { action: 'create', resourceType: 'parcel' },
  ui: { exception: 'test fixture' },
});
const feed = defineCapability({
  id: 'parcel.feed',
  kind: 'query',
  input: jsonSchema(z.strictObject({ cursor: z.string().optional() })),
  output: jsonSchema(
    z.strictObject({ items: z.array(z.string()), cursor: z.string(), more: z.boolean() }),
  ),
  permission: { action: 'read', resourceType: 'parcel' },
  ui: { exception: 'test fixture' },
});
const search = defineCapability({
  id: 'parcel.search',
  kind: 'query',
  input: jsonSchema(z.strictObject({ q: z.string(), cursor: z.string().optional() })),
  output: jsonSchema(z.strictObject({ items: z.array(z.string()), next: z.string().optional() })),
  permission: { action: 'read', resourceType: 'parcel' },
  ui: { exception: 'test fixture' },
});
type State = { parcels: string[] };

/**
 * A peer application served by the HTTP adapter in process, and a client to it that carries a
 * device's bearer credential, as `NetworkPort.client` would.
 */
function peer() {
  const bind = createHandlerFactory<State, {}>();
  const application = createApplication({
    modules: [defineModule({ id: 'parcels', capabilities: [receive, feed, search] })],
    storage: createMemoryStorage<State>({ parcels: [] }),
    services: {},
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    handlers: [
      bind(receive, (input, ctx) => {
        if (input.refuse) throw new ApplicationError('CONFLICT', 'The dock is closed');
        ctx.state.parcels.push(input.ref);
        ctx.change(`parcel:${input.ref}`);
        return { id: `P-${ctx.state.parcels.length}` };
      }),
      bind(feed, (input, ctx) => {
        const from = Number(input.cursor ?? 0);
        const items = ctx.state.parcels.slice(from, from + 2);
        const cursor = from + items.length;
        return { items, cursor: String(cursor), more: cursor < ctx.state.parcels.length };
      }),
      bind(search, (input) => {
        if (input.cursor === 'stale') throw new ApplicationError('INVALID_INPUT', 'Stale cursor');
        return input.cursor ? { items: ['P-2'] } : { items: [`P-1 ${input.q}`], next: 'page-2' };
      }),
    ],
  });
  const origin = 'http://127.0.0.1:4200';
  const sessions = new Sessions();
  const device = sessions.create({ workspaceId: 'w', principalId: 'device' });
  const handler = createHttpHandler({ application, sessions, origin: () => origin });
  const seen: RequestInit[] = [];
  const hooks = { fail: false, interrupt: false, token: device.token };
  const client: PeerClient = {
    async fetch(path, init = {}) {
      seen.push(init);
      init.signal?.throwIfAborted();
      if (hooks.fail) throw ((hooks.fail = false), new Error('connection reset'));
      const response = await handler(
        new Request(new URL(String(path), origin), {
          ...init,
          headers: {
            ...(init.headers as Record<string, string>),
            authorization: `Bearer ${hooks.token}`,
            host: '127.0.0.1:4200',
          },
        }),
      );
      if (hooks.interrupt) throw ((hooks.interrupt = false), new Error('reply lost'));
      return response;
    },
  };
  return { application, client, hooks, seen };
}

const effect = (id: string, payload: { ref: string; refuse?: boolean }) =>
  conformanceEffect({ id, target: 'peer', type: 'parcel.receive', payload });
const signal = () => new AbortController().signal;

/** Every parcel the peer recorded, read through its own feed. */
async function received(application: ReturnType<typeof peer>['application']) {
  const all: string[] = [];
  for (let cursor: string | undefined, more = true; more;) {
    const { data } = await application.queryRaw(
      { operation: feed.id, input: cursor === undefined ? {} : { cursor } },
      { workspaceId: 'w', principalId: 'device' },
    );
    const page = data as { items: string[]; cursor: string; more: boolean };
    all.push(...page.items);
    ({ cursor, more } = page);
  }
  return all;
}

function harness(): ConnectorHarness<string> {
  const { application, client, hooks } = peer();
  let next = 0;
  const port = createPeerPort<string>({
    target: 'peer',
    client: () => client,
    readBlob: async () => undefined,
    feed: feed.id,
  });
  return {
    port,
    accepted: () => effect(`e${++next}`, { ref: `r${next}` }),
    rejected: () => effect(`e${++next}`, { ref: `r${next}`, refuse: true }),
    applied: async (target) =>
      (await received(application)).filter((ref) => ref === (target.payload as { ref: string }).ref)
        .length,
    failNext: () => void (hooks.fail = true),
    interruptNext: () => void (hooks.interrupt = true),
    change: async () => {
      await port.deliver(effect(`c${++next}`, { ref: `c${next}` }), signal());
    },
  };
}

describe('the peer port conforms', () => {
  for (const check of connectorConformance(async () => harness()))
    test(check.name, async () => expect(await check.run()).toEqual({ passed: true }));
});

/** A peer that returns one error envelope for every call. */
const refusing = (status: number, error: ErrorEnvelope): PeerClient => ({
  fetch: async () => Response.json({ error }, { status }),
});
const portTo = (client: () => PeerClient, reference?: (result: unknown) => string | undefined) =>
  createPeerPort({
    target: 'peer',
    client,
    readBlob: async () => undefined,
    ...(reference ? { reference } : {}),
  });

describe('peer port', () => {
  test('an accepted delivery names the reference its result carries, never the cursor', async () => {
    const { client, seen } = peer();
    const port = portTo(
      () => client,
      (result) => (result as { id: string }).id,
    );
    expect(await port.deliver(effect('e1', { ref: 'r1' }), signal())).toEqual({
      status: 'accepted',
      externalRef: 'P-1',
    });
    expect(await portTo(() => client).deliver(effect('e2', { ref: 'r2' }), signal())).toEqual({
      status: 'accepted',
    });
    // Redirects are errors, so the credential never follows one to another host.
    expect(seen.every((init) => init.redirect === 'error')).toBe(true);
  });

  test('another command under the same key holds the effect instead of rejecting it', async () => {
    const { client } = peer();
    const port = portTo(() => client);
    await port.deliver(effect('e1', { ref: 'r1' }), signal());
    const error = await port.deliver(effect('e1', { ref: 'other' }), signal()).catch((e) => e);
    expect(error).toBeInstanceOf(DeliveryUncertain);
    expect(error.message).toBe("peer holds a different command under this effect's key");
  });

  test('a refused credential or assertion stays pending with a message saying why', async () => {
    const { client, hooks } = peer();
    hooks.token = 'revoked';
    const failure = (port: ReturnType<typeof portTo>) =>
      port.deliver(effect('e1', { ref: 'r1' }), signal()).then(
        (outcome) => new Error(`delivered: ${outcome.status}`),
        (error: Error) => error,
      );
    const revoked = await failure(portTo(() => client));
    expect(revoked).toBeInstanceOf(DeliveryFailure);
    expect(revoked.message).toBe(
      'The peer did not accept this device credential; pair the device again',
    );
    const assertion = (reason: string) =>
      refusing(403, { code: 'FORBIDDEN', message: 'Refused', details: { assertion: reason } });
    for (const reason of ['expired', 'replayed']) {
      const retried = await failure(portTo(() => assertion(reason)));
      expect(retried).toBeInstanceOf(DeliveryFailure);
      expect(retried.message).toBe(`peer refused the subject assertion (${reason})`);
    }
    expect((await failure(portTo(() => assertion('unmapped')))).message).toBe(
      'peer maps no person to the caller; ask its owner to map them',
    );
    // A plain FORBIDDEN is the peer's decision on the operation: the effect is rejected.
    expect(
      await portTo(() => refusing(403, { code: 'FORBIDDEN', message: 'Not yours' })).deliver(
        effect('e2', { ref: 'r2' }),
        signal(),
      ),
    ).toEqual({ status: 'rejected', code: 'FORBIDDEN', message: 'Not yours' });
    const disconnected = await failure(
      portTo(() => {
        throw new Error('not paired');
      }),
    );
    expect(disconnected.message).toBe('No connection to peer; pair the device first');
  });

  test('search serves a remote query with the peer query of the same ID', async () => {
    const { client } = peer();
    const port = portTo(() => client);
    const access = { credential: undefined, identity: 'service' as const };
    expect(
      await port.search!({ operation: search.id, query: { q: 'dock' } }, access, signal()),
    ).toEqual({ items: ['P-1 dock'], next: 'page-2' });
    expect(
      await port.search!(
        { operation: search.id, query: { q: 'dock', cursor: 'page-2' } },
        access,
        signal(),
      ),
    ).toEqual({ items: ['P-2'] });
    // The peer's refusal reaches the caller with its code; an outage is a delivery failure.
    await expect(
      port.search!({ operation: search.id, query: { q: 'x', cursor: 'stale' } }, access, signal()),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'Stale cursor' });
    await expect(
      portTo(() => refusing(503, { code: 'UNAVAILABLE', message: 'down' })).search!(
        { operation: search.id, query: { q: 'x' } },
        access,
        signal(),
      ),
    ).rejects.toBeInstanceOf(DeliveryFailure);
  });
});

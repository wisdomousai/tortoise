import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { createHttpHandler } from '@agent-native/adapters/http';
import { Sessions } from '@agent-native/adapters/http/sessions';
import {
  ApplicationError,
  defineCapability,
  defineModule,
  definePeerApi,
  definePeerTarget,
  jsonSchema,
} from '@agent-native/contracts';
import {
  connectPeerTarget,
  createPeerDrift,
  createPeerSource,
  DeliveryFailure,
  peerList,
  peerQuery,
  type PeerClient,
  type PeerLink,
} from '@agent-native/integration';
import {
  createApplication,
  createHandlerFactory,
  createMemoryStorage,
  type SourceCall,
} from '@agent-native/runtime';
import { conformanceEffect } from '../src/connectors';

const lotInput = z.strictObject({ lot: z.string() });
const requestInspection = defineCapability({
  id: 'inspection.request.create',
  kind: 'command',
  input: jsonSchema(lotInput),
  output: jsonSchema(z.strictObject({ id: z.string(), by: z.string() })),
  permission: { action: 'create', resourceType: 'inspection-request' },
  ui: { exception: 'test fixture' },
});
const comment = defineCapability({
  id: 'inspection.lot.comment',
  kind: 'command',
  input: jsonSchema(z.strictObject({ lot: z.string(), text: z.string() })),
  output: jsonSchema(z.strictObject({ by: z.string() })),
  permission: { action: 'update', resourceType: 'lot' },
  ui: { exception: 'test fixture' },
});
const lots = defineCapability({
  id: 'inspection.lot.list',
  kind: 'query',
  input: jsonSchema(z.strictObject({ q: z.string(), cursor: z.string().optional() })),
  output: jsonSchema(
    z.strictObject({
      items: z.array(z.strictObject({ externalId: z.string(), by: z.string() })),
      next: z.string().optional(),
    }),
  ),
  permission: { action: 'read', resourceType: 'lot' },
  ui: { exception: 'test fixture' },
});
const lot = defineCapability({
  id: 'inspection.lot.get',
  kind: 'query',
  input: jsonSchema(z.strictObject({ id: z.string() })),
  output: jsonSchema(z.strictObject({ externalId: z.string(), by: z.string() }).nullable()),
  permission: { action: 'read', resourceType: 'lot' },
  ui: { exception: 'test fixture' },
});
const api = definePeerApi({
  application: 'quality-inspection',
  commands: [requestInspection],
  onBehalfOf: { commands: [comment], queries: [lots, lot] },
});
const qualityTarget = definePeerTarget({
  target: 'quality',
  resourceType: 'QualitySync',
  api,
  changes: ['line'],
  status: {},
  descriptions: { complete: 'Complete.', status: 'Status.' },
  destination: {
    id: 'quality-peer',
    purpose: 'Quality inspection',
    dataClasses: ['lot'],
    availability: 'optional',
    offline: 'queue',
  },
  reads: true,
});

/** People the peer maps the caller's subjects to. */
const mapping: Record<string, string> = { rita: 'ann' };

/** The quality application, served in process; `requestInspection` may be swapped to drift its schema. */
function quality(capabilities = [requestInspection, comment, lots, lot]) {
  const bind = createHandlerFactory<{ by: string[] }, {}>();
  // Handlers bind the capabilities served, which a test may have changed.
  const served = <C extends { id: string }>(capability: C) =>
    capabilities.find(({ id }) => id === capability.id) as unknown as C;
  const application = createApplication({
    id: 'quality-inspection',
    modules: [defineModule({ id: 'inspection', capabilities })],
    storage: createMemoryStorage({ by: [] as string[] }),
    services: {},
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    handlers: [
      bind(served(requestInspection), (input, ctx) => {
        ctx.state.by.push(ctx.context.principalId);
        ctx.change(`inspection-request:${input.lot}`);
        return { id: `A-${ctx.state.by.length}`, by: ctx.context.principalId };
      }),
      bind(served(comment), (input, ctx) => {
        ctx.change(`lot:${input.lot}`);
        return { by: ctx.context.principalId };
      }),
      bind(served(lots), (input, ctx) =>
        input.cursor === 'p2'
          ? { items: [{ externalId: 'L2', by: ctx.context.principalId }] }
          : { items: [{ externalId: `L1 ${input.q}`, by: ctx.context.principalId }], next: 'p2' },
      ),
      bind(served(lot), (input, ctx) =>
        input.id === 'none' ? null : { externalId: input.id, by: ctx.context.principalId },
      ),
    ],
  });
  const origin = 'http://127.0.0.1:4300';
  // As the peer link would: the bearer is the receiving application's, a subject maps to a person.
  const handler = createHttpHandler({
    application,
    sessions: new Sessions(),
    origin: () => origin,
    authenticateToken: async (token, via, request) => {
      if (token !== 'receiving-credential') return undefined;
      const subject = request?.headers.get('x-subject') ?? undefined;
      if (subject !== undefined && !mapping[subject])
        throw new ApplicationError('FORBIDDEN', 'Unmapped subject', { assertion: 'unmapped' });
      const principalId = subject ? mapping[subject]! : 'peer:receiving';
      return {
        token,
        context: {
          workspaceId: 'w',
          principalId,
          peer: { id: 'receiving', ...(subject ? { subject } : {}) },
        },
        expiresAt: Infinity,
        credential: token,
        via,
      };
    },
  });
  const client = (headers: Record<string, string>): PeerClient => ({
    fetch: (path, init = {}) =>
      handler(
        new Request(new URL(String(path), origin), {
          ...init,
          headers: {
            ...(init.headers as Record<string, string>),
            ...headers,
            authorization: 'Bearer receiving-credential',
            host: '127.0.0.1:4300',
          },
        }),
      ),
  });
  const link: PeerLink = {
    client: () => client({}),
    onBehalfOf: (subject) => client({ 'x-subject': subject }),
  };
  return { application, link };
}

const receiving = () =>
  createApplication({
    modules: [],
    storage: createMemoryStorage({}),
    services: {},
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    handlers: [],
  });
const signal = () => new AbortController().signal;
const effect = (id: string, type: string, payload: object, principalId = 'rita') => ({
  ...conformanceEffect({ id, target: 'quality', type, payload: payload as never }),
  principalId,
});

describe('peer target', () => {
  test('a service command goes as the service principal, a personal one as its person', async () => {
    const { link } = quality();
    const integration = connectPeerTarget({
      target: qualityTarget,
      application: receiving(),
      workspaceId: 'local',
      principalId: 'integration',
      link: () => link,
      readBlob: async () => undefined,
      reference: (result) => (result as { id?: string; by: string }).id,
    });
    expect(
      await integration.port.deliver(effect('e1', requestInspection.id, { lot: 'L1' }), signal()),
    ).toEqual({
      status: 'accepted',
      externalRef: 'A-1',
    });
    const port = connectPeerTarget({
      target: qualityTarget,
      application: receiving(),
      workspaceId: 'local',
      principalId: 'integration',
      link: () => link,
      readBlob: async () => undefined,
      reference: (result) => (result as { by: string }).by,
    }).port;
    expect(
      await port.deliver(effect('e2', comment.id, { lot: 'L1', text: 'ok' }), signal()),
    ).toEqual({ status: 'accepted', externalRef: 'ann' });
    // An unmapped person stays pending with a message saying so.
    const unmapped = await port
      .deliver(effect('e3', comment.id, { lot: 'L1', text: 'x' }, 'sam'), signal())
      .then(
        () => undefined,
        (error: Error) => error,
      );
    expect(unmapped).toBeInstanceOf(DeliveryFailure);
    expect(unmapped!.message).toBe(
      'quality maps no person to the caller; ask its owner to map them',
    );
    // Without a connection the effect stays pending.
    const disconnected = connectPeerTarget({
      target: qualityTarget,
      application: receiving(),
      workspaceId: 'local',
      principalId: 'integration',
      link: () => {
        throw new Error('not connected');
      },
      readBlob: async () => undefined,
    }).port;
    await expect(
      disconnected.deliver(effect('e4', requestInspection.id, { lot: 'L1' }), signal()),
    ).rejects.toBeInstanceOf(DeliveryFailure);
  });

  test('a drifted operation keeps its effects pending until the two agree', async () => {
    const drifted = quality([
      {
        ...requestInspection,
        output: jsonSchema(z.strictObject({ id: z.string() })),
      } as unknown as typeof requestInspection,
      comment,
      lots,
      lot,
    ]);
    let peer = drifted;
    let now = 0;
    const drift = createPeerDrift({
      api,
      contract: () => contractOf(peer.link),
      now: () => now,
    });
    const port = connectPeerTarget({
      target: qualityTarget,
      application: receiving(),
      workspaceId: 'local',
      principalId: 'integration',
      link: () => peer.link,
      readBlob: async () => undefined,
      drift,
    }).port;
    const deliver = (id: string) =>
      port.deliver(effect(id, requestInspection.id, { lot: 'L1' }), signal()).then(
        (outcome) => outcome,
        (error: Error) => error.message,
      );
    const waiting =
      'inspection.request.create changed on quality; calls wait until the two applications agree';
    expect(await deliver('e1')).toBe(waiting);
    expect(drift.status()).toMatchObject({
      application: { id: 'quality-inspection' },
      drifted: [{ operation: requestInspection.id, reason: 'changed' }],
    });
    // Operations that still agree go through.
    expect(
      await port.deliver(effect('e2', comment.id, { lot: 'L1', text: 'ok' }), signal()),
    ).toMatchObject({ status: 'accepted' });
    // The peer is fixed; the stored result stands until ten minutes passed.
    peer = quality();
    expect(await deliver('e1')).toBe(waiting);
    now += 600_000;
    expect(await deliver('e1')).toMatchObject({ status: 'accepted' });
    // `warn` reports drift without blocking.
    const warned = createPeerDrift({
      api,
      contract: () => contractOf(drifted.link),
      onDrift: 'warn',
    });
    await warned.check();
    expect(warned.status().drifted).toHaveLength(1);
    expect(warned.blocked(requestInspection.id)).toBe(false);
  });
});

const contractOf = (link: PeerLink) =>
  link
    .client()
    .fetch('/api/v1/contract')
    .then((response) => response.json());

describe('peer source', () => {
  const call = (principalId: string, identity: SourceCall['identity'] = 'caller'): SourceCall => ({
    context: { workspaceId: 'local', principalId },
    identity,
    signal: signal(),
  });

  test('reads on behalf of the caller with page cursors bound to the query and the caller', async () => {
    const { link } = quality();
    const source = createPeerSource({
      target: 'quality',
      link: () => link,
      reads: {
        'quality.lot.search': peerList(lots, (query) => ({ q: query.q as string })),
        'quality.lot.lookup': peerQuery(lot, (query) => ({ id: query.externalId as string })),
      },
    });
    const first = await source.search(
      { operation: 'quality.lot.search', query: { q: 'steel' } },
      call('rita'),
    );
    expect(first).toMatchObject({
      items: [{ externalId: 'L1 steel', by: 'ann' }],
      identity: 'caller',
    });
    expect(first.next).not.toBe('p2');
    const second = await source.search(
      { operation: 'quality.lot.search', query: { q: 'steel', cursor: first.next! } },
      call('rita'),
    );
    expect(second).toEqual({ items: [{ externalId: 'L2', by: 'ann' }], identity: 'caller' });
    // The cursor pages neither another query nor another caller.
    for (const [query, principal] of [
      [{ q: 'copper', cursor: first.next! }, 'rita'],
      [{ q: 'steel', cursor: first.next! }, 'sam'],
      [{ q: 'steel', cursor: 'p2' }, 'rita'],
    ] as const)
      await expect(
        source.search({ operation: 'quality.lot.search', query }, call(principal)),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(
      await source.search(
        { operation: 'quality.lot.lookup', query: { externalId: 'none' } },
        call('rita'),
      ),
    ).toEqual({ items: [], identity: 'caller' });
    await expect(
      source.search({ operation: 'quality.lot.lookup', query: { externalId: 'L1' } }, call('sam')),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'quality maps no person to you; ask its owner to map you',
    });
  });

  test('a drifted or unreachable peer is unavailable', async () => {
    const drifted = quality([
      requestInspection,
      comment,
      {
        ...lots,
        output: jsonSchema(z.strictObject({ items: z.array(z.string()) })),
      } as unknown as typeof lots,
      lot,
    ]);
    const source = createPeerSource({
      target: 'quality',
      link: () => drifted.link,
      reads: { 'quality.lot.search': peerList(lots, (query) => ({ q: query.q as string })) },
      drift: createPeerDrift({ api, contract: () => contractOf(drifted.link) }),
    });
    await expect(
      source.search({ operation: 'quality.lot.search', query: { q: 'x' } }, call('rita')),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const away = createPeerSource({
      target: 'quality',
      link: () => ({
        client: () => ({
          fetch: async () => {
            throw new Error('refused');
          },
        }),
        onBehalfOf: () => ({
          fetch: async () => {
            throw new Error('refused');
          },
        }),
      }),
      reads: { 'quality.lot.search': peerList(lots, (query) => ({ q: query.q as string })) },
    });
    await expect(
      away.search({ operation: 'quality.lot.search', query: { q: 'x' } }, call('rita')),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'quality could not be read' });
  });
});

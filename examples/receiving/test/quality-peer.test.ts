import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionContext } from '@agent-native/runtime';
import { startPeerPair, type PeerPair } from '@agent-native/peer-link/testing';
import { createQualityInspectionApplication } from '@agent-native/quality-inspection/application';
import { FakeQualitySystem } from '@agent-native/quality-inspection/fake-sor';
import { createReceivingApplication } from '../application';
import { erpFolders } from '../contracts/erp-target';

/** Goods receiving and quality inspection, two hosts on loopback, connected with a code. */

const notice = [
  'id,purchaseOrder,supplier,sku,description,expected,inspect',
  'ASN-1-1,PO-4711,Acme Brakes,BRK-220,Brake disc 220 mm,10,true',
  'ASN-1-2,PO-4711,Acme Brakes,W8,Washer 8 mm,600,',
].join('\n');

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/**
 * The network between the two: requests pass to quality inspection, or it is down, or its
 * response is lost on the way back after it committed, or its contract reads as a newer one.
 */
type Weather = 'clear' | 'down' | 'lost' | 'drifted';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function pair() {
  const directory = await mkdtemp(join(tmpdir(), 'receiving-quality-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const qualityPort = await freePort();
  const weather = { now: 'clear' as Weather };
  const network = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      if (weather.now === 'down') return new Response('Bad gateway', { status: 502 });
      const url = new URL(request.url);
      // As a gateway would, it addresses quality inspection by its own host name.
      const headers = new Headers(request.headers);
      headers.delete('host');
      const response = await fetch(`http://127.0.0.1:${qualityPort}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        ...(request.method === 'GET' ? {} : { body: await request.arrayBuffer() }),
      });
      if (weather.now === 'lost') return new Response('Gateway timeout', { status: 504 });
      if (weather.now === 'drifted' && url.pathname === '/api/v1/contract') {
        // Quality inspection as a newer release would serve it: the create input changed.
        const contract = (await response.json()) as {
          operations: { id: string; schemaDigest?: string }[];
        };
        for (const operation of contract.operations)
          if (operation.id === 'inspection.request.create') operation.schemaDigest = 'sha256:newer';
        return Response.json(contract);
      }
      return response;
    },
  });
  cleanup.push(async () => void network.stop(true));

  const share = join(directory, 'share');
  for (const folder of Object.values(erpFolders))
    await mkdir(join(share, folder), { recursive: true });
  const policy = join(directory, 'site-policy.json');
  await writeFile(
    policy,
    JSON.stringify({
      profile: 'desktop-local',
      mode: 'connected',
      audit: { mode: 'best-effort' },
      folders: Object.fromEntries(
        Object.values(erpFolders).map((folder) => [folder, { path: join(share, folder) }]),
      ),
      destinations: {
        'quality-peer': { url: network.url.origin, addresses: ['127.0.0.1/32'] },
      },
    }),
  );
  const started: PeerPair = await startPeerPair({
    callee: createQualityInspectionApplication({ systemOfRecord: new FakeQualitySystem() }),
    caller: () =>
      createReceivingApplication({ members: { rita: 'editor', sam: 'editor' }, quietMs: 0 }),
    target: 'quality',
    destination: 'quality-peer',
    fetch,
    subjects: { rita: 'ina' },
    hosts: { callee: { port: qualityPort }, caller: { settings: { 'site-policy': policy } } },
  });
  cleanup.push(() => started.close());
  const { callee, caller, owner } = started;
  // Quality inspection: lots from its quality system, Ina inspects at P100, Vic holds no role.
  await callee.integrations.sync();
  await callee.application.invokeRaw(
    {
      operation: 'inspection.plant.set-member',
      input: { plant: 'P100', principalId: 'ina', role: 'inspector' },
      idempotencyKey: 'ina',
    },
    owner,
  );
  await writeFile(join(share, erpFolders.inbox, 'asn-1.csv'), notice);
  await caller.integrations.target('erp').inbound.runOnce();

  let keys = 0;
  const as = (principalId: string): ExecutionContext => ({ ...owner, principalId });
  const receiving = {
    command: async (operation: string, input: unknown, principalId = 'rita') =>
      (
        await caller.application.invokeRaw(
          { operation, input, idempotencyKey: `r-${++keys}` },
          as(principalId),
        )
      ).result as Record<string, any>,
    query: async (operation: string, input: unknown, principalId = 'rita') =>
      (await caller.application.queryRaw({ operation, input }, as(principalId))).data as Record<
        string,
        any
      >,
    line: async (id: string) =>
      (await caller.application.queryRaw({ operation: 'delivery.get', input: { id } }, owner))
        .data as Record<string, any>,
    deliver: () =>
      caller.integrations
        .target('quality')
        .dispatcher.runOnce(new AbortController().signal, { ignoreBackoff: true }),
    sync: () => caller.integrations.target('quality').inbound.runOnce(),
    pending: async () =>
      (
        await caller.application.pendingEffects(as('quality-integration'), { target: 'quality' })
      ).map((effect) => effect.lastFailure),
  };
  const quality = {
    command: async (operation: string, input: unknown, principalId = 'ina') =>
      (
        await callee.application.invokeRaw(
          { operation, input, idempotencyKey: `q-${++keys}` },
          as(principalId),
        )
      ).result as Record<string, any>,
    inspectionRequests: async (principalId = 'ina') =>
      (
        (
          await callee.application.queryRaw(
            { operation: 'inspection.request.list', input: {} },
            as(principalId),
          )
        ).data as { items: Record<string, any>[] }
      ).items,
  };
  /** Count and post both notice lines as Rita. */
  async function post() {
    for (const [id, counted] of [
      ['ASN-1-1', 10],
      ['ASN-1-2', 600],
    ] as const) {
      await receiving.command('delivery.receive', { id, counted });
      await receiving.command('erp.send', { id });
    }
  }
  return { ...started, weather, receiving, quality, post };
}

describe('receiving calls quality inspection as a peer', () => {
  test('a line marked for inspection is sent, closed there and its outcome comes back', async () => {
    const { peerId, receiving, quality, post } = await pair();
    await post();
    expect((await receiving.line('ASN-1-1')).inspection).toEqual({
      effectId: expect.any(String),
      sync: 'pending',
    });
    expect((await receiving.line('ASN-1-2')).inspection).toBeUndefined();

    expect(await receiving.deliver()).toMatchObject({ accepted: 1 });
    const [request] = await quality.inspectionRequests();
    expect(request).toMatchObject({
      delivery: 'ASN-1-1',
      sku: 'BRK-220',
      quantity: 10,
      requestedBy: `peer:${peerId}`,
      status: 'open',
    });
    expect((await receiving.line('ASN-1-1')).inspection).toMatchObject({
      sync: 'accepted',
      sorRef: request!.id,
    });
    // Inspection requests are for people who capture at some plant.
    expect(await quality.inspectionRequests('vic')).toEqual([]);

    await quality.command('inspection.request.close', {
      id: request!.id,
      outcome: 'rejected',
      note: 'Runout above limit',
    });
    expect(await receiving.sync()).toMatchObject({ items: 1 });
    expect((await receiving.line('ASN-1-1')).inspection).toMatchObject({
      outcome: 'rejected',
      note: 'Runout above limit',
    });
    expect(await receiving.query('quality.sync.status', {})).toMatchObject({
      pending: 0,
      inspecting: 0,
      failed: 1,
    });
  });

  test('lots are searched as the mapped person there, and an unmapped person is refused', async () => {
    const { receiving } = await pair();
    const found = await receiving.query('quality.lot.search', { q: 'Brake' });
    // Ina inspects at P100 only, so the P200 brake disc is not found.
    expect(found.items.map((lot: { externalId: string }) => lot.externalId)).toEqual(['4000001']);
    expect(found.source).toMatchObject({ status: 'ok', identity: 'caller' });
    await expect(
      receiving.query('quality.lot.search', { q: 'Brake' }, 'sam'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('an inspection request waits while quality inspection is down, and a lost response is not sent twice', async () => {
    const { weather, receiving, quality, post } = await pair();
    await post();
    weather.now = 'down';
    expect(await receiving.deliver()).toMatchObject({ accepted: 0 });
    expect(await receiving.pending()).toEqual(['The peer could not accept the delivery now']);

    // Quality inspection commits the request, and the response is lost on the way back.
    weather.now = 'lost';
    expect(await receiving.deliver()).toMatchObject({ accepted: 0 });
    expect(await quality.inspectionRequests()).toHaveLength(1);

    weather.now = 'clear';
    expect(await receiving.deliver()).toMatchObject({ accepted: 1 });
    const requests = await quality.inspectionRequests();
    expect(requests).toHaveLength(1);
    expect((await receiving.line('ASN-1-1')).inspection).toMatchObject({
      sync: 'accepted',
      sorRef: requests[0]!.id,
    });
  });

  test('a changed create command on quality inspection keeps the request pending', async () => {
    const { weather, receiving, quality, post } = await pair();
    weather.now = 'drifted';
    await post();
    expect(await receiving.deliver()).toMatchObject({ accepted: 0 });
    expect(await receiving.pending()).toEqual([
      'inspection.request.create changed on quality; calls wait until the two applications agree',
    ]);
    expect(await quality.inspectionRequests()).toEqual([]);
  });
});

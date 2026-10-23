import { afterEach, describe, expect, test } from 'bun:test';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  connectPeerTarget,
  createPeerSource,
  DeliveryFailure,
  peerQuery,
  type PeerLink,
} from '@agent-native/integration';
import { conformanceEffect } from '@agent-native/testing/connectors';
import { peerLinkServiceOf } from '../src/service';
import { startPeerPair, type PeerPair } from '../src/testing';
import {
  announce,
  hold,
  qualityApplication,
  qualityTarget,
  receivingApplication,
  whoami,
} from './fixtures';

const pairs: PeerPair[] = [];
afterEach(async () => {
  for (const pair of pairs.splice(0)) await pair.close();
});

async function pair(reach?: Parameters<typeof startPeerPair>[0]['reach']) {
  const started = await startPeerPair({
    callee: qualityApplication(),
    caller: receivingApplication,
    target: 'quality',
    destination: 'quality-api',
    fetch,
    subjects: { rita: 'ann' },
    ...(reach ? { reach } : {}),
  });
  pairs.push(started);
  return started;
}

const linkOf = (started: PeerPair): PeerLink =>
  peerLinkServiceOf(started.caller.services)!.link('quality');
const portOf = (started: PeerPair) =>
  connectPeerTarget({
    target: qualityTarget,
    application: started.caller.application,
    workspaceId: started.owner.workspaceId,
    principalId: 'quality-integration',
    link: () => linkOf(started),
    readBlob: async () => undefined,
    reference: (result) => (result as { by: string }).by,
  }).port;
const signal = () => new AbortController().signal;
let effects = 0;
const effect = (type: string, payload: object, principalId = 'rita', runId?: string) => ({
  ...conformanceEffect({
    id: `e-${++effects}`,
    target: 'quality',
    type,
    payload: payload as never,
  }),
  principalId,
  ...(runId ? { runId } : {}),
});
const failure = (promise: Promise<unknown>) =>
  promise.then(
    (outcome) => new Error(`delivered: ${JSON.stringify(outcome)}`),
    (error: Error) => error,
  );

describe('connection', () => {
  test('connecting records the connection and keeps the credential out of state', async () => {
    const started = await pair();
    const { data } = await started.caller.application.queryRaw(
      { operation: 'peer.connection.list', input: {} },
      started.owner,
    );
    const listed = data as {
      targets: { target: string; connection: { peerId: string; contract: { id: string } } }[];
    };
    expect(listed.targets).toMatchObject([
      { target: 'quality', connection: { peerId: started.peerId, contract: { id: 'quality' } } },
    ]);
    expect(JSON.stringify(listed)).not.toContain('token');
    // Without a platform secret store the credential is a file only the host's account reads.
    const directory = join(started.caller.workspacePath, 'peer-link');
    expect(await readdir(directory)).toEqual(['quality.json']);
    expect((await stat(join(directory, 'quality.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
  });

  test('a code of another application is refused and connects nothing', async () => {
    const started = await pair();
    const { result } = await started.callee.application.invokeRaw(
      {
        operation: 'peer.enrollment.create',
        input: { label: 'Again' },
        idempotencyKey: 'again',
      },
      started.owner,
    );
    const linked = peerLinkServiceOf(started.caller.services)!;
    await expect(
      linked.connect({ target: 'nowhere', code: (result as { code: string }).code }, started.owner),
    ).rejects.toThrow('nowhere is not a peer target here');
    await expect(
      linked.connect({ target: 'quality', code: 'WRONGCODE1' }, started.owner),
    ).rejects.toThrow('quality refused the code');
    await expect(
      linked.connect(
        { target: 'quality', code: (result as { code: string }).code },
        { ...started.owner, principalId: 'stranger' },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('a removed connection keeps effects pending and deletes the credential', async () => {
    const started = await pair();
    await started.caller.application.invokeRaw(
      { operation: 'peer.connection.remove', input: { target: 'quality' }, idempotencyKey: 'rm' },
      started.owner,
    );
    const refused = await failure(
      portOf(started).deliver(effect(announce.id, { lot: 'L1' }), signal()),
    );
    expect(refused).toBeInstanceOf(DeliveryFailure);
    expect(refused.message).toBe('No connection to quality; connect it on the peers screen');
    expect(await readdir(join(started.caller.workspacePath, 'peer-link'))).toEqual([]);
  });
});

describe('delivery', () => {
  test('a service effect goes as the peer, a personal one as the mapped person', async () => {
    const started = await pair();
    const port = portOf(started);
    expect(await port.deliver(effect(announce.id, { lot: 'L1' }), signal())).toEqual({
      status: 'accepted',
      externalRef: `peer:${started.peerId}`,
    });
    expect(await port.deliver(effect(hold.id, { lot: 'L1' }), signal())).toEqual({
      status: 'accepted',
      externalRef: 'ann',
    });
  });

  test('a personal effect a run enqueued is refused by default', async () => {
    const started = await pair();
    const refused = await failure(
      portOf(started).deliver(effect(hold.id, { lot: 'L1' }, 'rita', 'run-1'), signal()),
    );
    expect(refused.message).toBe(
      'quality takes no calls an agent or job run makes on behalf of a person',
    );
  });

  test('an unmapped person waits with a message', async () => {
    const started = await pair();
    const refused = await failure(
      portOf(started).deliver(effect(hold.id, { lot: 'L1' }, 'sam'), signal()),
    );
    expect(refused.message).toBe('quality maps no person to the caller; ask its owner to map them');
  });
});

describe('client', () => {
  test('headers a caller sets cannot replace the credential or the assertion', async () => {
    const started = await pair();
    const link = linkOf(started);
    const forged = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer forged',
      'Agent-Native-Subject': 'v1.forged.forged',
      Cookie: 'agent_session=forged',
    };
    const ask = async (client: ReturnType<PeerLink['client']>) =>
      (await (
        await client.fetch(`/api/v1/queries/${whoami.id}`, {
          method: 'POST',
          headers: forged,
          body: JSON.stringify({ input: {} }),
        })
      ).json()) as { data?: { principalId: string }; error?: { code: string } };
    expect((await ask(link.onBehalfOf('rita'))).data?.principalId).toBe('ann');
    // The service client sends no assertion, forged or not: whoami is on behalf of people only.
    expect((await ask(link.client())).error?.code).toBe('FORBIDDEN');
  });

  test('a redirect to another host is an error, and the other host gets nothing', async () => {
    const seen: (string | null)[] = [];
    const elsewhere = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (request) => {
        seen.push(request.headers.get('authorization'));
        return Response.json({ data: { principalId: 'elsewhere' } });
      },
    });
    const redirector = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (request) =>
        Response.redirect(new URL(new URL(request.url).pathname, elsewhere.url), 307),
    });
    let redirecting = false;
    const started = await pair((url, init, callee) =>
      fetch(new URL(url.pathname + url.search, redirecting ? redirector.url : callee), init),
    );
    redirecting = true;
    try {
      const refused = await failure(
        portOf(started).deliver(effect(hold.id, { lot: 'L1' }), signal()),
      );
      expect(refused).toBeInstanceOf(DeliveryFailure);
      expect(refused.message).toBe('The peer is unreachable');
      expect(seen).toEqual([]);
    } finally {
      redirector.stop(true);
      elsewhere.stop(true);
    }
  });

  test('a remote read runs on behalf of the caller, and an unmapped caller is refused', async () => {
    const started = await pair();
    const source = createPeerSource({
      target: 'quality',
      link: () => linkOf(started),
      reads: { 'receiving.lot.who': peerQuery(whoami, () => ({})) },
    });
    const call = (principalId: string) => ({
      context: { workspaceId: started.owner.workspaceId, principalId },
      identity: 'caller' as const,
      signal: signal(),
    });
    const page = await source.search(
      { operation: 'receiving.lot.who', query: {} },
      call('rita') as never,
    );
    expect(page.items).toMatchObject([{ principalId: 'ann' }]);
    await expect(
      source.search({ operation: 'receiving.lot.who', query: {} }, call('sam') as never),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // A read a run makes is refused like its deliveries.
    await expect(
      source.search({ operation: 'receiving.lot.who', query: {} }, {
        ...call('rita'),
        context: { ...call('rita').context, runId: 'run-1' },
      } as never),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

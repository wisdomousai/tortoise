import { afterEach, describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateAssertionKey } from '../src/assertion';
import { definePeerApi } from '@agent-native/contracts';
import {
  requestInspection,
  hold,
  purge,
  refusal,
  release,
  startQuality,
  whoami,
  type Quality,
} from './fixtures';

const opened: Quality[] = [];
afterEach(async () => {
  for (const quality of opened.splice(0)) await quality.close();
});

async function quality(clock = { now: Date.now() }, options?: Parameters<typeof startQuality>[2]) {
  const started = await startQuality(fetch, clock, options);
  opened.push(started);
  return started;
}

const dataOf = async (response: Response) => {
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: Record<string, unknown> }).data;
};
const resultOf = async (response: Response) => {
  expect(response.status).toBe(200);
  return ((await response.json()) as { result: Record<string, unknown> }).result;
};

describe('enrollment', () => {
  test('a code is redeemed once, and the list shows no code, credential or key', async () => {
    const q = await quality();
    const { code } = await q.command('peer.enrollment.create', { label: 'Receiving' });
    const key = await generateAssertionKey();
    const body = { code, application: 'receiving', publicKey: key.publicKey };
    const first = await q.redeem(body);
    expect(first.status).toBe(201);
    expect(first.headers.get('cache-control')).toBe('no-store');
    const reply = (await first.json()) as {
      token: string;
      peer: { id: string; audience: string };
      contract: { id: string };
    };
    expect(reply.peer.audience).toBe(`quality#${reply.peer.id}`);
    expect(reply.contract.id).toBe('quality');
    expect((await refusal(await q.redeem(body))).code).toBe('FORBIDDEN');
    const listed = JSON.stringify(await q.query('peer.list'));
    expect(listed).not.toContain(reply.token);
    expect(listed).not.toContain(code);
    expect(listed).not.toContain('tokenDigest');
    expect(listed).not.toContain(key.publicKey);
  });

  test('enrollment refuses operations outside the API service list', async () => {
    const q = await quality();
    await expect(
      q.command('peer.enrollment.create', { label: 'R', operations: [whoami.id] }),
    ).rejects.toThrow('Not service operations of the peer API');
  });

  test('startup refuses an API of another application or with unknown operations', async () => {
    await expect(
      quality(undefined, { api: definePeerApi({ application: 'receiving' }) }),
    ).rejects.toThrow('The peer API of receiving cannot be served by quality');
    const stray = { ...whoami, id: 'quality.stray' };
    await expect(
      quality(undefined, {
        api: definePeerApi({ application: 'quality', onBehalfOf: { queries: [stray] } }),
      }),
    ).rejects.toThrow('unknown operations: quality.stray');
  });
});

describe('service principal', () => {
  test('a peer acts as peer:<id> within the service operations only', async () => {
    const q = await quality();
    const peer = await q.enroll();
    const result = await resultOf(await q.invoke(peer, requestInspection.id, { lot: 'L1' }));
    expect(result.by).toBe(`peer:${peer.peerId}`);
    // Not on the service list: the grant refuses it, as it refuses the plugin's own operations.
    for (const operation of [hold.id, purge.id])
      expect((await refusal(await q.invoke(peer, operation, { lot: 'L1' }))).code).toBe(
        'FORBIDDEN',
      );
    expect((await refusal(await q.ask(peer, 'peer.list', {}))).code).toBe('FORBIDDEN');
  });

  test('a narrowed enrollment grants only its operations', async () => {
    const q = await quality();
    const peer = await q.enroll({ operations: [] });
    expect((await refusal(await q.invoke(peer, requestInspection.id, { lot: 'L1' }))).code).toBe(
      'FORBIDDEN',
    );
  });

  test('a revoked peer is refused as a credential at its next request', async () => {
    const q = await quality();
    const peer = await q.enroll();
    await resultOf(await q.invoke(peer, requestInspection.id, { lot: 'L1' }));
    await q.command('peer.revoke', { peerId: peer.peerId });
    const refused = await refusal(await q.invoke(peer, requestInspection.id, { lot: 'L2' }));
    expect(refused.details).toEqual({ credential: 'rejected' });
    const signed = await refusal(await q.ask(peer, whoami.id, {}, { subject: 'rita' }));
    expect(signed.details).toEqual({ credential: 'rejected' });
  });
});

describe('on behalf of a person', () => {
  async function mapped(options?: Parameters<typeof startQuality>[2]) {
    const clock = { now: Date.now() };
    const q = await quality(clock, options);
    const peer = await q.enroll();
    await q.command('peer.subject.map', {
      peerId: peer.peerId,
      subject: 'rita',
      principalId: 'ann',
    });
    await q.command('peer.subject.map', {
      peerId: peer.peerId,
      subject: 'sam',
      principalId: 'bob',
    });
    return { q, peer, clock };
  }

  test('a mapped subject acts as its person, under that person policy', async () => {
    const { q, peer } = await mapped();
    expect(await dataOf(await q.ask(peer, whoami.id, {}, { subject: 'rita' }))).toEqual({
      principalId: 'ann',
      peer: { id: peer.peerId, subject: 'rita' },
      delegated: true,
    });
    expect(
      (await resultOf(await q.invoke(peer, hold.id, { lot: 'L1' }, { subject: 'rita' }))).by,
    ).toBe('ann');
    // Bob views only: his own policy refuses the hold.
    expect(
      (await refusal(await q.invoke(peer, hold.id, { lot: 'L1' }, { subject: 'sam' }))).code,
    ).toBe('FORBIDDEN');
  });

  test('a person-only rule refuses the call, and a service operation is not on behalf of anyone', async () => {
    const { q, peer } = await mapped();
    expect(
      (await refusal(await q.invoke(peer, release.id, { lot: 'L1' }, { subject: 'rita' }))).code,
    ).toBe('FORBIDDEN');
    expect(
      (
        await refusal(
          await q.invoke(peer, requestInspection.id, { lot: 'L1' }, { subject: 'rita' }),
        )
      ).code,
    ).toBe('FORBIDDEN');
    expect(
      (await refusal(await q.invoke(peer, purge.id, { lot: 'L1' }, { subject: 'rita' }))).code,
    ).toBe('FORBIDDEN');
  });

  test('the grant is the API intersected with the mapping', async () => {
    const { q, peer } = await mapped();
    await q.command('peer.subject.map', {
      peerId: peer.peerId,
      subject: 'rita',
      principalId: 'ann',
      operations: [whoami.id],
    });
    await dataOf(await q.ask(peer, whoami.id, {}, { subject: 'rita' }));
    expect(
      (await refusal(await q.invoke(peer, hold.id, { lot: 'L1' }, { subject: 'rita' }))).code,
    ).toBe('FORBIDDEN');
    await expect(
      q.command('peer.subject.map', {
        peerId: peer.peerId,
        subject: 'rita',
        principalId: 'ann',
        operations: [requestInspection.id],
      }),
    ).rejects.toThrow('Not on-behalf-of operations');
  });

  test('an unmapped subject is refused as unmapped, and unmapping applies at the next call', async () => {
    const { q, peer } = await mapped();
    const unknown = await refusal(await q.ask(peer, whoami.id, {}, { subject: 'zoe' }));
    expect(unknown).toMatchObject({ code: 'FORBIDDEN', details: { assertion: 'unmapped' } });
    await q.command('peer.subject.unmap', { peerId: peer.peerId, subject: 'rita' });
    expect((await refusal(await q.ask(peer, whoami.id, {}, { subject: 'rita' }))).details).toEqual({
      assertion: 'unmapped',
    });
  });

  test('service, device and reserved principals are never mapped to', async () => {
    const { q, peer } = await mapped();
    for (const principalId of [`peer:${peer.peerId}`, 'device:d-1', 'erp-integration'])
      await expect(
        q.command('peer.subject.map', { peerId: peer.peerId, subject: 'x', principalId }),
      ).rejects.toThrow('service principal');
  });

  test('same sign-in maps a subject to the same person, but never to a reserved one', async () => {
    const q = await quality();
    const peer = await q.enroll({ subjects: 'same' });
    expect((await dataOf(await q.ask(peer, whoami.id, {}, { subject: 'ann' }))).principalId).toBe(
      'ann',
    );
    for (const subject of ['erp-integration', `peer:${peer.peerId}`, 'owner:x'])
      expect((await refusal(await q.ask(peer, whoami.id, {}, { subject }))).details).toEqual({
        assertion: 'unmapped',
      });
  });

  test('a call a delegated run made on the caller is refused unless the application allows it', async () => {
    const { q, peer } = await mapped();
    expect(
      (await refusal(await q.ask(peer, whoami.id, {}, { subject: 'rita', act: 'agent' }))).details,
    ).toEqual({ assertion: 'agent' });
    const allowing = await mapped({ agents: 'allow' });
    expect(
      (
        await dataOf(
          await allowing.q.ask(allowing.peer, whoami.id, {}, { subject: 'rita', act: 'agent' }),
        )
      ).principalId,
    ).toBe('ann');
  });

  test('launch and events are refused on behalf of a person', async () => {
    const { q, peer } = await mapped();
    const launch = await refusal(await q.call(peer, '/api/v1/launch', {}, { subject: 'rita' }));
    expect(launch).toMatchObject({ code: 'FORBIDDEN' });
    expect(launch.message).toContain('no session or stream');
  });
});

describe('assertion attacks', () => {
  async function mapped() {
    const clock = { now: Date.now() };
    const q = await quality(clock);
    const peer = await q.enroll();
    const other = await q.enroll();
    for (const enrolled of [peer, other])
      await q.command('peer.subject.map', {
        peerId: enrolled.peerId,
        subject: 'rita',
        principalId: 'ann',
      });
    return { q, peer, other, clock };
  }
  const reason = async (response: Response) => (await refusal(response)).details?.assertion;

  test('expired, too long and future assertions are refused as expired', async () => {
    const { q, peer, clock } = await mapped();
    const now = Math.floor(clock.now / 1000);
    for (const claims of [
      { iat: now - 200, exp: now - 80 },
      { iat: now - 10, exp: now + 200 },
      { iat: now + 120, exp: now + 180 },
      { iat: now, exp: now },
    ])
      expect(await reason(await q.ask(peer, whoami.id, {}, { subject: 'rita', claims }))).toBe(
        'expired',
      );
  });

  test('an assertion for another peer audience, or signed by another key, is refused', async () => {
    const { q, peer, other } = await mapped();
    expect(
      await reason(
        await q.ask(peer, whoami.id, {}, { subject: 'rita', claims: { aud: other.audience } }),
      ),
    ).toBe('audience');
    // Another peer's key with this peer's bearer.
    expect(
      await reason(await q.ask(peer, whoami.id, {}, { subject: 'rita', key: other.key })),
    ).toBe('signature');
    expect(await reason(await q.ask(peer, whoami.id, {}, { header: 'v1.e30.AAAA' }))).toBe(
      'signature',
    );
    expect(await reason(await q.ask(peer, whoami.id, {}, { header: 'not an assertion' }))).toBe(
      'signature',
    );
  });

  test('an assertion moved to another operation or body is refused', async () => {
    const { q, peer } = await mapped();
    expect(
      await reason(
        await q.ask(
          peer,
          whoami.id,
          {},
          {
            subject: 'rita',
            sentPath: `/api/v1/commands/${hold.id}`,
            sentBody: JSON.stringify({ input: {} }),
          },
        ),
      ),
    ).toBe('request');
    expect(
      await reason(
        await q.invoke(
          peer,
          hold.id,
          { lot: 'L1' },
          {
            subject: 'rita',
            sentBody: JSON.stringify({ input: { lot: 'L2' }, idempotencyKey: 'k-1' }),
          },
        ),
      ),
    ).toBe('body');
  });

  test('an assertion is used once', async () => {
    const { q, peer } = await mapped();
    const first = await q.ask(
      peer,
      whoami.id,
      {},
      { subject: 'rita', claims: { jti: 'a'.repeat(32) } },
    );
    await dataOf(first);
    expect(
      await reason(
        await q.ask(peer, whoami.id, {}, { subject: 'rita', claims: { jti: 'a'.repeat(32) } }),
      ),
    ).toBe('replayed');
  });

  test('an assertion without the peer bearer is no credential', async () => {
    const { q, peer } = await mapped();
    const response = await q.ask(
      { ...peer, token: 'x'.repeat(43) },
      whoami.id,
      {},
      { subject: 'rita' },
    );
    expect((await refusal(response)).details).toEqual({ credential: 'rejected' });
  });
});

/** Every file under `directory`, as bytes. */
async function files(directory: string): Promise<Buffer[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => readFile(join(entry.parentPath, entry.name))),
  );
}

test('no credential or private key is kept in the workspace', async () => {
  const q = await quality();
  const { code } = await q.command('peer.enrollment.create', { label: 'Receiving' });
  const key = await generateAssertionKey();
  const reply = (await (
    await q.redeem({ code, application: 'receiving', publicKey: key.publicKey })
  ).json()) as { token: string; peer: { id: string; audience: string } };
  const peer = { token: reply.token, peerId: reply.peer.id, audience: reply.peer.audience, key };
  await q.command('peer.subject.map', { peerId: peer.peerId, subject: 'rita', principalId: 'ann' });
  await resultOf(await q.invoke(peer, requestInspection.id, { lot: 'L1' }));
  const signed = await q.invoke(peer, hold.id, { lot: 'L2' }, { subject: 'rita' });
  await resultOf(signed);
  await q.host.close();
  for (const bytes of await files(q.directory))
    // The one-use code stays in the receipt of peer.enrollment.create, as device-link's does;
    // it is worthless once redeemed or expired.
    for (const [name, secret] of Object.entries({ token: reply.token, key: key.privateKey }))
      expect(bytes.includes(secret) ? name : undefined).toBeUndefined();
});

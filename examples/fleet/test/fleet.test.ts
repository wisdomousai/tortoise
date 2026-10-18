import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBundle, generateSigningKey } from '@agent-native/bundle';
import type { BlobRef } from '@agent-native/contracts';
import { startHost } from '@agent-native/host/host';
import { createFleetApplication } from '../application';
import { owner, startPlant } from './site';

const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function temporary(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/** The fleet on loopback, with a clock the test moves. */
async function startFleet() {
  const clock = { now: Date.now() };
  const directory = await temporary('fleet-');
  await writeFile(
    join(directory, 'site-policy.json'),
    JSON.stringify({ profile: 'desktop-local', audit: { mode: 'best-effort' } }),
  );
  const fleet = await startHost(createFleetApplication({ services: { now: () => clock.now } }), {
    workspacePath: join(directory, 'workspace'),
    integration: false,
    settings: { 'site-policy': join(directory, 'site-policy.json') },
  });
  cleanups.push(() => fleet.close());
  const command = async (operation: string, input: unknown) =>
    (
      await fleet.application.invokeRaw(
        { operation, input, idempotencyKey: crypto.randomUUID() },
        owner,
      )
    ).result as Record<string, any>;
  const query = async (operation: string, input: unknown = {}) =>
    (await fleet.application.queryRaw({ operation, input }, owner)).data as Record<string, any>;
  const plant = async (settings: { trust?: string; relay?: boolean } = {}) => {
    const { code } = await command('link.enrollment.create', {
      label: 'Plant',
      kind: 'field-sync',
    });
    const started = await startPlant(
      (url, init) => fetch(new URL(url.pathname + url.search, fleet.url), init),
      { code, ...settings },
    );
    cleanups.push(started.close);
    await started.agent.sync();
    expect(started.agent.status().lastError).toBeUndefined();
    const id = (await query('site.list')).items.at(-1).id as string;
    return { ...started, id };
  };
  /** Call the fleet's API as a site, with its credential. */
  const asSite = (credential: string, path: string, body?: unknown) =>
    fetch(fleet.url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { fleet, clock, command, query, plant, asSite };
}

test('a site reports its outbox, and the health view flags held, stale and silent sites', async () => {
  const { clock, query, plant } = await startFleet();
  const site = await plant();
  await site.addNote('one');
  await site.addNote('two');
  await site.agent.sync();
  const record = await query('site.get', { id: site.id });
  expect(record).toMatchObject({ application: 'plant', pending: 2, held: 0 });
  expect(record.targets).toEqual([{ target: 'erp', pending: 2, held: 0, upstream: 0 }]);
  expect((await query('fleet.health')).issues).toEqual([]);

  clock.now += 16 * 60_000;
  expect((await query('fleet.health')).issues).toEqual([
    expect.objectContaining({ site: site.id, kind: 'stale' }),
  ]);
});

async function publish(
  fleet: Awaited<ReturnType<typeof startFleet>>,
  id: string,
  key: Awaited<ReturnType<typeof generateSigningKey>>,
) {
  const directory = await temporary('bundle-');
  const payload = join(directory, 'payload');
  await mkdir(payload);
  await writeFile(join(payload, 'plant'), `binary ${id}`);
  const out = join(directory, 'bundle');
  const manifest = await createBundle(
    payload,
    out,
    {
      application: 'plant',
      version: id,
      platform: 'linux-x64',
      storageSchema: 1,
      catalogDigest: 'a'.repeat(64),
      requirements: { network: [], devices: [], processes: [] },
    },
    key,
  );
  const files: BlobRef[] = [];
  for (const file of manifest.files)
    files.push(
      await fleet.fleet.application.putBlob(
        new Uint8Array(await Bun.file(join(out, 'files', file.path)).arrayBuffer()),
        'application/octet-stream',
        owner,
      ),
    );
  const signature = JSON.parse(await Bun.file(join(out, 'bundle.sig')).text());
  await fleet.command('release.publish', {
    release: { id, version: id, manifest: JSON.parse(JSON.stringify(manifest)), signature },
    files,
  });
  return files;
}

test('a release reaches the sites on its channel, verified, and no other release is readable', async () => {
  const fleet = await startFleet();
  const key = await generateSigningKey();
  const trustDirectory = await temporary('trust-');
  const trust = join(trustDirectory, 'key.pub.json');
  await writeFile(trust, JSON.stringify({ keyId: key.keyId, publicKey: key.publicKey }));
  const [stable] = await publish(fleet, '1.0.0', key);
  const [beta] = await publish(fleet, '1.1.0', key);
  await fleet.command('channel.assign', { id: 'stable', release: '1.0.0' });
  const site = await fleet.plant({ trust });

  // No channel yet: nothing to stage, and no release is readable.
  const credential = await site.credential();
  expect((await fleet.asSite(credential, `/api/v1/blobs/${stable!.digest}`)).status).toBe(404);
  await fleet.command('site.update', { id: site.id, label: 'Plant 4', channel: 'stable' });
  expect((await fleet.query('fleet.health')).issues).toEqual([
    expect.objectContaining({ site: site.id, kind: 'release-drift' }),
  ]);

  await site.agent.sync();
  await site.agent.sync();
  expect(site.agent.status().staged).toMatchObject({ release: '1.0.0' });
  expect(await readdir(site.releases)).toEqual(['1.0.0']);
  expect(await fleet.query('site.get', { id: site.id })).toMatchObject({
    label: 'Plant 4',
    channel: 'stable',
    staged: '1.0.0',
  });
  expect((await fleet.query('fleet.health')).issues).toEqual([]);
  // The site reads its channel's release and nothing else.
  expect((await fleet.asSite(credential, `/api/v1/blobs/${stable!.digest}`)).status).toBe(200);
  expect((await fleet.asSite(credential, `/api/v1/blobs/${beta!.digest}`)).status).toBe(404);
});

test('a release whose blobs are not exactly its files is refused', async () => {
  const fleet = await startFleet();
  const key = await generateSigningKey();
  const [file] = await publish(fleet, '1.0.0', key);
  const release = await fleet.query('release.get', { id: '1.0.0' });
  const again = {
    id: '1.0.1',
    version: '1.0.1',
    manifest: release.manifest,
    signature: release.signature,
  };
  const refused = await fleet.fleet.application
    .invokeRaw(
      {
        operation: 'release.publish',
        input: { release: again, files: [file, file] },
        idempotencyKey: crypto.randomUUID(),
      },
      owner,
    )
    .catch((error: { code?: string }) => error);
  expect(refused).toMatchObject({ code: 'INVALID_INPUT' });
});

test('forwarded audit events are verified, and a forged one stops collection visibly', async () => {
  const { query, plant, asSite } = await startFleet();
  const site = await plant();
  await site.addNote('audited');
  await site.agent.sync();
  const record = await query('site.get', { id: site.id });
  expect(record.auditSeq).toBeGreaterThan(0);
  expect(record.auditBroken).toBeUndefined();
  const events = await query('audit-event.list', { site: site.id, limit: 100 });
  expect(events.total).toBe(record.auditSeq);

  // A forged next event: linked correctly, but its hash is not over its contents.
  const forged = {
    kind: 'command.committed',
    seq: record.auditSeq + 1,
    at: Date.now(),
    source: { component: 'host', instance: 'forged' },
    prev: record.auditHash,
    hash: 'f'.repeat(64),
  };
  const response = await asSite(await site.credential(), '/api/v1/commands/fleet.audit.ingest', {
    input: { events: [JSON.stringify(forged)] },
    idempotencyKey: crypto.randomUUID(),
  });
  expect(response.status).toBe(200);
  expect(((await response.json()) as { result: unknown }).result).toEqual({
    afterSeq: record.auditSeq,
  });
  const broken = await query('site.get', { id: site.id });
  expect(broken.auditBroken).toBe(`Audit event ${record.auditSeq + 1} does not match its hash`);
  expect((await query('fleet.health')).issues).toEqual([
    expect.objectContaining({ site: site.id, kind: 'audit-broken' }),
  ]);
  // Later genuine events are not accepted past the break.
  await site.addNote('after');
  await site.agent.sync();
  expect((await query('site.get', { id: site.id })).auditSeq).toBe(record.auditSeq);
});

test('a site calls only the fleet protocol, about itself', async () => {
  const { command, plant, asSite } = await startFleet();
  const site = await plant();
  const credential = await site.credential();
  const calls: [string, unknown][] = [
    ['site.update', { id: site.id, channel: 'stable' }],
    ['relay.request', { site: site.id, method: 'GET', path: '/api/v1/queries/notes.count' }],
    ['channel.assign', { id: 'stable', release: '1.0.0' }],
  ];
  for (const [operation, input] of calls) {
    const response = await asSite(credential, `/api/v1/commands/${operation}`, {
      input,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(response.status).toBe(403);
  }
  const listed = await asSite(credential, '/api/v1/queries/site.list', { input: {} });
  expect(listed.status).toBe(403);

  // Another site neither takes nor answers this site's request.
  const other = await plant();
  const otherCredential = await other.credential();
  const { id } = await command('relay.request', {
    site: site.id,
    method: 'GET',
    path: '/api/v1/queries/notes.count',
  });
  const call = (token: string, operation: string, input: unknown) =>
    asSite(token, `/api/v1/commands/${operation}`, { input, idempotencyKey: crypto.randomUUID() });
  const stolen = await call(otherCredential, 'fleet.relay.take', {});
  expect(((await stolen.json()) as { result: unknown }).result).toEqual({});
  const taken = await call(credential, 'fleet.relay.take', {});
  expect(((await taken.json()) as { result: { request: { id: string } } }).result.request.id).toBe(
    id,
  );
  const answer = { id, status: 200, headers: {} };
  expect((await call(otherCredential, 'fleet.relay.answer', answer)).status).toBe(409);
  expect((await call(credential, 'fleet.relay.answer', answer)).status).toBe(200);
});

test('an operator reaches a site’s API through the relay only with a session the site issued', async () => {
  const { command, query, plant } = await startFleet();
  const site = await plant({ relay: true });
  await site.addNote('relayed');
  const ask = async (headers: Record<string, string>) => {
    const { id } = await command('relay.request', {
      site: site.id,
      method: 'POST',
      path: '/api/v1/queries/notes.count',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ input: {} }),
    });
    expect((await query('relay.get', { id })).status).toBe('waiting');
    expect(await site.agent.relay()).toBe(true);
    return query('relay.get', { id });
  };

  expect(await ask({})).toMatchObject({ status: 'answered', response: 403 });
  const session = site.host.sessions.create(owner, 60_000);
  const answered = await ask({ authorization: `Bearer ${session.token}` });
  expect(answered).toMatchObject({ status: 'answered', response: 200 });
  expect(JSON.parse(Buffer.from(answered.responseBody, 'base64').toString())).toMatchObject({
    data: { count: 1 },
  });
  // The session never shows in what the fleet lists.
  const listed = JSON.stringify(await query('relay.list', { site: site.id }));
  expect(listed).not.toContain(session.token);
  expect(listed).not.toContain('outgoing');
});

import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBundle, generateSigningKey } from '@tortoise/bundle';
import type { BlobRef } from '@tortoise/contracts';
import { startHost } from '@tortoise/host/host';
import { createFleetApplication } from '../application';
import { localUser, startPlant } from './instance';

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
    join(directory, 'deployment-policy.json'),
    JSON.stringify({ profile: 'desktop-local', audit: { mode: 'best-effort' } }),
  );
  const fleet = await startHost(createFleetApplication({ services: { now: () => clock.now } }), {
    workspacePath: join(directory, 'workspace'),
    integration: false,
    settings: { 'deployment-policy': join(directory, 'deployment-policy.json') },
  });
  cleanups.push(() => fleet.close());
  const command = async (operation: string, input: unknown) =>
    (
      await fleet.application.invokeRaw(
        { operation, input, idempotencyKey: crypto.randomUUID() },
        localUser,
      )
    ).result as Record<string, any>;
  const query = async (operation: string, input: unknown = {}) =>
    (await fleet.application.queryRaw({ operation, input }, localUser)).data as Record<string, any>;
  const plant = async (settings: { trust?: string; relay?: boolean; builtAt?: string } = {}) => {
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
    const id = (await query('instance.list')).items.at(-1).id as string;
    return { ...started, id };
  };
  /** Call the fleet's API as an instance, with its credential. */
  const asInstance = (credential: string, path: string, body?: unknown) =>
    fetch(fleet.url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { fleet, clock, command, query, plant, asInstance };
}

test('an instance reports its outbox, and the health view flags held, stale and silent instances', async () => {
  const { clock, query, plant } = await startFleet();
  const instance = await plant();
  await instance.addNote('one');
  await instance.addNote('two');
  await instance.agent.sync();
  const record = await query('instance.get', { id: instance.id });
  expect(record).toMatchObject({ application: 'plant', pending: 2, held: 0 });
  expect(record.targets).toEqual([{ target: 'erp', pending: 2, held: 0, acknowledged: 0 }]);
  expect((await query('fleet.health')).issues).toEqual([]);

  clock.now += 16 * 60_000;
  expect((await query('fleet.health')).issues).toEqual([
    expect.objectContaining({ instance: instance.id, kind: 'stale' }),
  ]);
});

test('an instance reports its best-before date, and the health view flags a build past it', async () => {
  const { clock, query, plant } = await startFleet();
  // Built 40 days ago with a 30-day shelf life.
  const builtAt = new Date(clock.now - 40 * 86_400_000).toISOString();
  const instance = await plant({ builtAt });
  const { bestBefore } = await query('instance.get', { id: instance.id });
  expect(bestBefore).toBe(
    new Date(Date.parse(builtAt) + 30 * 86_400_000).toISOString().slice(0, 10),
  );
  expect((await query('fleet.health')).issues).toEqual([
    {
      instance: instance.id,
      kind: 'past-best-before',
      detail: `Runs a build past its best-before date of ${bestBefore}`,
    },
  ]);
  // The instance keeps reporting and its records keep flowing; the date only informs.
  await instance.addNote('still running');
  await instance.agent.sync();
  expect(await query('instance.get', { id: instance.id })).toMatchObject({ pending: 1 });
});

test('an operator removes a decommissioned instance, and its forwarded audit events stay', async () => {
  const { command, query, plant } = await startFleet();
  const instance = await plant();
  await instance.addNote('audited');
  await instance.agent.sync();
  await command('relay.request', {
    instance: instance.id,
    method: 'GET',
    path: '/api/v1/queries/notes.count',
  });
  const forwarded = (await query('audit-event.list', { instance: instance.id, limit: 100 })).total;
  expect(forwarded).toBeGreaterThan(0);
  const devices = (await query('link.device.list')).devices as { id: string }[];
  await command('link.device.revoke', { deviceId: devices.at(-1)!.id });

  expect(await command('instance.remove', { id: instance.id })).toEqual({ removed: true });
  expect((await query('instance.list')).items).toEqual([]);
  expect((await query('relay.list', { instance: instance.id })).items).toEqual([]);
  expect((await query('fleet.health')).issues).toEqual([]);
  expect((await query('audit-event.list', { instance: instance.id, limit: 100 })).total).toBe(
    forwarded,
  );
  // Its credential is revoked, so it does not report its way back.
  await instance.agent.sync();
  expect((await query('instance.list')).items).toEqual([]);
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
        localUser,
      ),
    );
  const signature = JSON.parse(await Bun.file(join(out, 'bundle.sig')).text());
  await fleet.command('release.publish', {
    release: { id, version: id, manifest: JSON.parse(JSON.stringify(manifest)), signature },
    files,
  });
  return files;
}

test('a release reaches the instances on its channel, verified, and no other release is readable', async () => {
  const fleet = await startFleet();
  const key = await generateSigningKey();
  const trustDirectory = await temporary('trust-');
  const trust = join(trustDirectory, 'key.pub.json');
  await writeFile(trust, JSON.stringify({ keyId: key.keyId, publicKey: key.publicKey }));
  const [stable] = await publish(fleet, '1.0.0', key);
  const [beta] = await publish(fleet, '1.1.0', key);
  await fleet.command('channel.assign', { id: 'stable', release: '1.0.0' });
  const instance = await fleet.plant({ trust });

  // No channel yet: nothing to stage, and no release is readable.
  const credential = await instance.credential();
  expect((await fleet.asInstance(credential, `/api/v1/blobs/${stable!.digest}`)).status).toBe(404);
  await fleet.command('instance.update', { id: instance.id, label: 'Plant 4', channel: 'stable' });
  expect((await fleet.query('fleet.health')).issues).toEqual([
    expect.objectContaining({ instance: instance.id, kind: 'release-drift' }),
  ]);

  await instance.agent.sync();
  await instance.agent.sync();
  expect(instance.agent.status().staged).toMatchObject({ release: '1.0.0' });
  expect(await readdir(instance.releases)).toEqual(['1.0.0']);
  expect(await fleet.query('instance.get', { id: instance.id })).toMatchObject({
    label: 'Plant 4',
    channel: 'stable',
    staged: '1.0.0',
  });
  expect((await fleet.query('fleet.health')).issues).toEqual([]);
  // The instance reads its channel's release and nothing else.
  expect((await fleet.asInstance(credential, `/api/v1/blobs/${stable!.digest}`)).status).toBe(200);
  expect((await fleet.asInstance(credential, `/api/v1/blobs/${beta!.digest}`)).status).toBe(404);
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
      localUser,
    )
    .catch((error: { code?: string }) => error);
  expect(refused).toMatchObject({ code: 'INVALID_INPUT' });
});

test('forwarded audit events are verified, and a forged one stops collection visibly', async () => {
  const { query, plant, asInstance } = await startFleet();
  const instance = await plant();
  await instance.addNote('audited');
  await instance.agent.sync();
  const record = await query('instance.get', { id: instance.id });
  expect(record.auditSeq).toBeGreaterThan(0);
  expect(record.auditBroken).toBeUndefined();
  const events = await query('audit-event.list', { instance: instance.id, limit: 100 });
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
  const response = await asInstance(
    await instance.credential(),
    '/api/v1/commands/fleet.audit.ingest',
    {
      input: { events: [JSON.stringify(forged)] },
      idempotencyKey: crypto.randomUUID(),
    },
  );
  expect(response.status).toBe(200);
  expect(((await response.json()) as { result: unknown }).result).toEqual({
    afterSeq: record.auditSeq,
  });
  const broken = await query('instance.get', { id: instance.id });
  expect(broken.auditBroken).toBe(`Audit event ${record.auditSeq + 1} does not match its hash`);
  expect((await query('fleet.health')).issues).toEqual([
    expect.objectContaining({ instance: instance.id, kind: 'audit-broken' }),
  ]);
  // Later genuine events are not accepted past the break.
  await instance.addNote('after');
  await instance.agent.sync();
  expect((await query('instance.get', { id: instance.id })).auditSeq).toBe(record.auditSeq);
});

test('an instance calls only the fleet protocol, about itself', async () => {
  const { command, plant, asInstance } = await startFleet();
  const instance = await plant();
  const credential = await instance.credential();
  const calls: [string, unknown][] = [
    ['instance.update', { id: instance.id, channel: 'stable' }],
    [
      'relay.request',
      { instance: instance.id, method: 'GET', path: '/api/v1/queries/notes.count' },
    ],
    ['channel.assign', { id: 'stable', release: '1.0.0' }],
  ];
  for (const [operation, input] of calls) {
    const response = await asInstance(credential, `/api/v1/commands/${operation}`, {
      input,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(response.status).toBe(403);
  }
  const listed = await asInstance(credential, '/api/v1/queries/instance.list', { input: {} });
  expect(listed.status).toBe(403);

  // Another instance neither takes nor responds to this instance's request.
  const other = await plant();
  const otherCredential = await other.credential();
  const { id } = await command('relay.request', {
    instance: instance.id,
    method: 'GET',
    path: '/api/v1/queries/notes.count',
  });
  const call = (token: string, operation: string, input: unknown) =>
    asInstance(token, `/api/v1/commands/${operation}`, {
      input,
      idempotencyKey: crypto.randomUUID(),
    });
  const stolen = await call(otherCredential, 'fleet.relay.claim', {});
  expect(((await stolen.json()) as { result: unknown }).result).toEqual({});
  const taken = await call(credential, 'fleet.relay.claim', {});
  expect(((await taken.json()) as { result: { request: { id: string } } }).result.request.id).toBe(
    id,
  );
  const reply = { id, status: 200, headers: {} };
  expect((await call(otherCredential, 'fleet.relay.respond', reply)).status).toBe(409);
  expect((await call(credential, 'fleet.relay.respond', reply)).status).toBe(200);
});

test('an operator reaches an instance’s API through the relay only with a session the instance issued', async () => {
  const { command, query, plant } = await startFleet();
  const instance = await plant({ relay: true });
  await instance.addNote('relayed');
  const ask = async (headers: Record<string, string>) => {
    const { id } = await command('relay.request', {
      instance: instance.id,
      method: 'POST',
      path: '/api/v1/queries/notes.count',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ input: {} }),
    });
    expect((await query('relay.get', { id })).status).toBe('queued');
    expect(await instance.agent.relay()).toBe(true);
    return query('relay.get', { id });
  };

  expect(await ask({})).toMatchObject({ status: 'responded', response: 403 });
  const session = instance.host.sessions.create(localUser, 60_000);
  const responded = await ask({ authorization: `Bearer ${session.token}` });
  expect(responded).toMatchObject({ status: 'responded', response: 200 });
  expect(JSON.parse(Buffer.from(responded.responseBody, 'base64').toString())).toMatchObject({
    data: { count: 1 },
  });
  // The session never shows in what the fleet lists.
  const listed = JSON.stringify(await query('relay.list', { instance: instance.id }));
  expect(listed).not.toContain(session.token);
  expect(listed).not.toContain('outgoing');
});

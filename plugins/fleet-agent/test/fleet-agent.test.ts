import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBundle, generateSigningKey, type BundleManifest } from '@agent-native/bundle';
import type { BlobRef } from '@agent-native/contracts';
import { startHost } from '@agent-native/host/host';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from '@agent-native/kernel/authority';
import type { FleetRelease, RelayAnswer, SiteReport } from '../src/contracts';
import type { FleetAgentService } from '../src/plugin';
import { fleetNetworkFixture } from '../src/testing';
import { fleetApplication, siteApplication } from './fixtures';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };

async function temporary(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

interface FleetView {
  sites: Record<
    string,
    {
      report?: SiteReport;
      auditSeq: number;
      events: string[];
      answers: Record<string, RelayAnswer>;
    }
  >;
}

async function startFleet() {
  const fleet = await startHost(fleetApplication(), {
    workspacePath: join(await temporary('fleet-'), 'workspace'),
    integration: false,
  });
  cleanups.push(() => fleet.close());
  const command = async (operation: string, input: unknown) =>
    (
      await fleet.application.invokeRaw(
        { operation, input, idempotencyKey: crypto.randomUUID() },
        owner,
      )
    ).result as Record<string, any>;
  const view = async () =>
    (await fleet.application.queryRaw({ operation: 'fixture.fleet.get', input: {} }, owner))
      .data as unknown as FleetView;
  const code = async () =>
    (
      (await command('link.enrollment.create', { label: 'Plant 4', kind: 'field-sync' })) as {
        code: string;
      }
    ).code;
  return { fleet, command, view, code };
}

/**
 * A site whose `fleet` destination reaches `fleetUrl` unless `link.offline` is set, as an
 * unplugged uplink would. With `link.corrupt`, blob downloads arrive with one byte changed;
 * `link.drop` loses the fleet's answer to the next request to that path, after the fleet handled it. `trust` and `relay` are the agent's settings.
 */
async function startSite(
  fleetUrl: string,
  settings: { code?: string; trust?: string; relay?: boolean } = {},
) {
  const directory = await temporary('site-');
  const releases = join(directory, 'releases');
  await mkdir(releases);
  const policy = {
    profile: 'desktop-local',
    audit: { mode: 'best-effort' },
    folders: { 'fleet-releases': { path: releases } },
  };
  await writeFile(join(directory, 'site-policy.json'), JSON.stringify(policy));
  const link: { offline: boolean; corrupt: boolean; drop?: string } = {
    offline: false,
    corrupt: false,
  };
  const network = fleetNetworkFixture(async (url, init) => {
    if (link.offline) throw new TypeError('Network is unreachable');
    const response = await fetch(new URL(url.pathname + url.search, fleetUrl), init);
    if (link.drop && url.pathname === link.drop) {
      link.drop = undefined;
      throw new TypeError('Connection reset');
    }
    if (!link.corrupt || !url.pathname.startsWith('/api/v1/blobs/')) return response;
    const bytes = new Uint8Array(await response.arrayBuffer());
    bytes[0] = bytes[0]! ^ 1;
    return new Response(bytes, { status: response.status, headers: response.headers });
  });
  const site = await startHost(siteApplication(network), {
    workspacePath: join(directory, 'workspace'),
    integration: false,
    settings: {
      'site-policy': join(directory, 'site-policy.json'),
      ...(settings.code ? { 'fleet-enrollment-code': settings.code } : {}),
      ...(settings.trust ? { 'fleet-trust': settings.trust } : {}),
      ...(settings.relay ? { 'fleet-relay': 'on' } : {}),
    },
  });
  cleanups.push(() => site.close());
  const agent = site.services['fleet-agent'] as FleetAgentService;
  const addNote = (text: string) =>
    site.application.invokeRaw(
      { operation: 'notes.add', input: { text }, idempotencyKey: crypto.randomUUID() },
      owner,
    );
  return { site, agent, link, releases, addNote };
}

const onlySite = (view: FleetView) => {
  const [entry] = Object.values(view.sites);
  return entry!;
};

test('a site enrolls once and reports its outbox by target, never the payloads', async () => {
  const { fleet, view, code } = await startFleet();
  const { agent, addNote } = await startSite(fleet.url, { code: await code() });
  await addNote('first');
  await addNote('second');
  await agent.sync();

  expect(agent.status().enrolled).toBe(true);
  expect(agent.status().lastError).toBeUndefined();
  const reports = agent.status().reports;
  const report = onlySite(await view()).report!;
  expect(report.application).toBe('plant');
  expect(report.outbox).toEqual({
    pending: 2,
    held: 0,
    upstream: 0,
    targets: [{ target: 'erp', pending: 2, held: 0, upstream: 0 }],
  });
  expect(JSON.stringify(report)).not.toContain('first');
  // The one-use code is spent; the stored credential keeps the site enrolled.
  await agent.sync();
  expect(agent.status().reports).toBe(reports + 1);
  expect(Object.keys((await view()).sites)).toHaveLength(1);
});

test('without an enrollment code the site runs and says why it is not reporting', async () => {
  const { fleet } = await startFleet();
  const { agent, addNote } = await startSite(fleet.url);
  await addNote('local');
  await agent.sync();
  expect(agent.status()).toMatchObject({ enrolled: false, reports: 0 });
  expect(agent.status().lastError).toContain('fleet-enrollment-code');
});

test('audit events reach the fleet in order, and a lost reply is resent without gaps or repeats', async () => {
  const { fleet, view, code } = await startFleet();
  const { site, agent, link, addNote } = await startSite(fleet.url, { code: await code() });
  const head = () => (site.services.audit as { head(): { seq: number } }).head().seq;
  const sequences = async () =>
    onlySite(await view()).events.map((line) => (JSON.parse(line) as { seq: number }).seq);
  await addNote('one');
  await agent.sync();
  const first = await sequences();
  expect(first.length).toBeGreaterThan(0);
  expect(first).toEqual(first.map((_, index) => index + 1));
  expect(agent.status().auditForwarded).toBe(first.length);

  // The fleet stores the next batch, but its answer never arrives.
  await addNote('two');
  link.drop = '/api/v1/commands/fleet.audit.ingest';
  await agent.sync();
  expect(agent.status().lastError).toContain('Connection reset');
  const stored = await sequences();
  expect(stored.length).toBeGreaterThan(first.length);

  // The next cycle asks where the fleet's copy ends and sends only what follows.
  await addNote('three');
  await agent.sync();
  expect(agent.status().lastError).toBeUndefined();
  const all = await sequences();
  expect(all).toEqual(all.map((_, index) => index + 1));
  expect(all.length).toBeGreaterThan(stored.length);
  expect(all.length).toBeLessThanOrEqual(head());
});

test('while the fleet is unreachable the site commits, and the next report shows the backlog', async () => {
  const { fleet, view, code } = await startFleet();
  const { agent, link, addNote } = await startSite(fleet.url, { code: await code() });
  await agent.sync();
  const reports = agent.status().reports;
  link.offline = true;
  for (const text of ['a', 'b', 'c']) await addNote(text);
  await agent.sync();
  expect(agent.status().lastError).toContain('unreachable');
  expect(agent.status().reports).toBe(reports);
  expect(onlySite(await view()).report!.outbox.pending).toBe(0);

  link.offline = false;
  await agent.sync();
  expect(agent.status().lastError).toBeUndefined();
  expect(onlySite(await view()).report!.outbox).toMatchObject({ pending: 3, held: 0 });
});

async function publishRelease(
  command: (operation: string, input: unknown) => Promise<unknown>,
  fleetApp: {
    putBlob(data: Uint8Array, mediaType: string, context: typeof owner): Promise<BlobRef>;
  },
  directory: string,
  options: { tamper?: boolean } = {},
) {
  const key = await generateSigningKey();
  const payload = join(directory, 'payload');
  await mkdir(join(payload, 'web'), { recursive: true });
  await writeFile(join(payload, 'app'), 'binary');
  await writeFile(join(payload, 'web', 'index.html'), '<!doctype html>');
  const out = join(directory, 'bundle');
  const manifest: BundleManifest = await createBundle(
    payload,
    out,
    {
      application: 'plant',
      version: '2.0.0',
      platform: 'linux-x64',
      storageSchema: 1,
      catalogDigest: 'a'.repeat(64),
      requirements: { network: [], devices: [], processes: [] },
    },
    key,
  );
  const files: BlobRef[] = [];
  const listed = [];
  for (const file of manifest.files) {
    let bytes = new Uint8Array(await Bun.file(join(out, 'files', file.path)).arrayBuffer());
    // A fleet that swaps a file must also change its manifest entry, which the signature covers.
    if (options.tamper && file.path === 'app') bytes = new TextEncoder().encode('binarx');
    const ref = await fleetApp.putBlob(bytes, 'application/octet-stream', owner);
    files.push(ref);
    listed.push({ ...file, sha256: ref.digest.slice('sha256:'.length), size: ref.size });
  }
  const signature = JSON.parse(await Bun.file(join(out, 'bundle.sig')).text());
  const release: FleetRelease = {
    id: 'plant-2.0.0',
    version: '2.0.0',
    manifest: JSON.parse(JSON.stringify({ ...manifest, files: listed })),
    signature,
  };
  await command('fixture.release.set', { release, files });
  const trust = join(directory, 'key.pub.json');
  await writeFile(trust, JSON.stringify({ keyId: key.keyId, publicKey: key.publicKey }));
  return { trust };
}

test('a signed release is staged verified, and a changed one never reaches the folder', async () => {
  const { fleet, command, code } = await startFleet();
  const { trust } = await publishRelease(command, fleet.application, await temporary('release-'));
  const corrupted = await startSite(fleet.url, { code: await code(), trust });
  // Changed in transit: the file does not match the signed manifest's digest.
  corrupted.link.corrupt = true;
  await corrupted.agent.sync();
  expect(corrupted.agent.status().lastError).toContain('another digest');
  expect(corrupted.agent.status().staged).toBeUndefined();
  expect(await readdir(corrupted.releases)).toEqual([]);

  corrupted.link.corrupt = false;
  await corrupted.agent.sync();
  expect(corrupted.agent.status().lastError).toBeUndefined();
  expect(corrupted.agent.status().staged).toMatchObject({
    release: 'plant-2.0.0',
    version: '2.0.0',
  });
  expect(await readdir(corrupted.releases)).toEqual(['plant-2.0.0']);
  expect((await readdir(join(corrupted.releases, 'plant-2.0.0'))).sort()).toEqual([
    'bundle.json',
    'bundle.sig',
    'files',
  ]);

  // Changed at the fleet: the manifest names the swapped file, so the signature no longer holds.
  const other = await startFleet();
  const tampered = await publishRelease(
    other.command,
    other.fleet.application,
    await temporary('tampered-'),
    {
      tamper: true,
    },
  );
  const site = await startSite(other.fleet.url, {
    code: await other.code(),
    trust: tampered.trust,
  });
  await site.agent.sync();
  expect(site.agent.status().lastError).toContain('signature');
  expect(site.agent.status().staged).toBeUndefined();
  expect(await readdir(site.releases)).toEqual([]);
});

test('the relay reaches an operation only with a session the site issued', async () => {
  const { fleet, command, view, code } = await startFleet();
  const { site, agent, addNote } = await startSite(fleet.url, { code: await code(), relay: true });
  await addNote('relayed');
  await agent.sync();
  const siteId = Object.keys((await view()).sites)[0]!;
  const ask = async (id: string, headers: Record<string, string>) => {
    await command('fixture.relay.enqueue', {
      site: siteId,
      request: {
        id,
        method: 'POST',
        path: '/api/v1/queries/notes.count',
        headers: { 'content-type': 'application/json', ...headers },
        body: Buffer.from(JSON.stringify({ input: {} })).toString('base64'),
      },
    });
    expect(await agent.relay()).toBe(true);
    return onlySite(await view()).answers[id]!;
  };

  expect((await ask('anonymous', {})).status).toBe(403);
  // The fleet holds the site's fleet credential, and it opens nothing on the site.
  const credential = await Bun.file(join(site.workspacePath, 'fleet-agent', 'credential')).text();
  expect((await ask('fleet-token', { authorization: `Bearer ${credential}` })).status).toBe(403);

  const session = site.sessions.create(owner, 60_000);
  const answer = await ask('operator', { authorization: `Bearer ${session.token}` });
  expect(answer.status).toBe(200);
  expect(JSON.parse(Buffer.from(answer.body!, 'base64').toString())).toMatchObject({
    data: { count: 1 },
  });
  expect(Object.keys(answer.headers)).not.toContain('set-cookie');
  expect(await agent.relay()).toBe(false);
});

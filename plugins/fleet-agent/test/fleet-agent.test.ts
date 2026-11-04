import { afterEach, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStorage } from '@tortoise/adapters/sqlite';
import {
  createBundle,
  generateSigningKey,
  requirementsDigest,
  type BundleManifest,
  type SigningKey,
} from '@tortoise/bundle';
import type { BlobRef } from '@tortoise/contracts';
import { startHost } from '@tortoise/host/host';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from '@tortoise/kernel/instance';
import type { FleetRelease, RelayResponse, InstanceReport } from '../src/contracts';
import type { FleetAgentService } from '../src/plugin';
import { fleetNetworkFixture } from '../src/testing';
import { fleetApplication, instanceApplication } from './fixtures';

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
  instances: Record<
    string,
    {
      report?: InstanceReport;
      auditSeq: number;
      events: string[];
      responses: Record<string, RelayResponse>;
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
 * An instance whose `fleet` destination reaches `fleetUrl` unless `link.offline` is set, as an
 * unplugged uplink would. With `link.corrupt`, blob downloads come back with one byte changed;
 * `link.drop` loses the fleet's response to the next request to that path, after the fleet handled it. `trust` and `relay` are the agent's settings; `workspace` puts the workspace where an install keeps it.
 */
async function startInstance(
  fleetUrl: string,
  settings: { code?: string; trust?: string; relay?: boolean; workspace?: string } = {},
) {
  const directory = await temporary('instance-');
  const releases = join(directory, 'releases');
  await mkdir(releases);
  const policy = {
    profile: 'desktop-local',
    audit: { mode: 'best-effort' },
    folders: { 'fleet-releases': { path: releases } },
  };
  await writeFile(join(directory, 'deployment-policy.json'), JSON.stringify(policy));
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
  const instance = await startHost(instanceApplication(network), {
    workspacePath: settings.workspace ?? join(directory, 'workspace'),
    integration: false,
    settings: {
      'deployment-policy': join(directory, 'deployment-policy.json'),
      ...(settings.code ? { 'fleet-enrollment-code': settings.code } : {}),
      ...(settings.trust ? { 'fleet-trust': settings.trust } : {}),
      ...(settings.relay ? { 'fleet-relay': 'on' } : {}),
    },
  });
  cleanups.push(() => instance.close());
  const agent = instance.services['fleet-agent'] as FleetAgentService;
  const addNote = (text: string) =>
    instance.application.invokeRaw(
      { operation: 'notes.add', input: { text }, idempotencyKey: crypto.randomUUID() },
      owner,
    );
  return {
    instance,
    agent,
    link,
    releases,
    addNote,
    policy: join(directory, 'deployment-policy.json'),
  };
}

const onlyInstance = (view: FleetView) => {
  const [entry] = Object.values(view.instances);
  return entry!;
};

test('an instance enrolls once and reports its outbox by target, never the payloads', async () => {
  const { fleet, view, code } = await startFleet();
  const { agent, addNote } = await startInstance(fleet.url, { code: await code() });
  await addNote('first');
  await addNote('second');
  await agent.sync();

  expect(agent.status().enrolled).toBe(true);
  expect(agent.status().lastError).toBeUndefined();
  const reports = agent.status().reports;
  const report = onlyInstance(await view()).report!;
  expect(report.application).toBe('plant');
  expect(report.outbox).toEqual({
    pending: 2,
    held: 0,
    acknowledged: 0,
    targets: [{ target: 'erp', pending: 2, held: 0, acknowledged: 0 }],
  });
  expect(JSON.stringify(report)).not.toContain('first');
  // The one-use code is spent; the stored credential keeps the instance enrolled.
  await agent.sync();
  expect(agent.status().reports).toBe(reports + 1);
  expect(Object.keys((await view()).instances)).toHaveLength(1);
});

test('without an enrollment code the instance runs and says why it is not reporting', async () => {
  const { fleet } = await startFleet();
  const { agent, addNote } = await startInstance(fleet.url);
  await addNote('local');
  await agent.sync();
  expect(agent.status()).toMatchObject({ enrolled: false, reports: 0 });
  expect(agent.status().lastError).toContain('fleet-enrollment-code');
});

test('audit events reach the fleet in order, and a lost reply is resent without gaps or repeats', async () => {
  const { fleet, view, code } = await startFleet();
  const { instance, agent, link, addNote } = await startInstance(fleet.url, { code: await code() });
  const head = () => (instance.services.audit as { head(): { seq: number } }).head().seq;
  const sequences = async () =>
    onlyInstance(await view()).events.map((line) => (JSON.parse(line) as { seq: number }).seq);
  await addNote('one');
  await agent.sync();
  const first = await sequences();
  expect(first.length).toBeGreaterThan(0);
  expect(first).toEqual(first.map((_, index) => index + 1));
  expect(agent.status().auditForwarded).toBe(first.length);

  // The fleet stores the next batch, but its response is lost.
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

test('while the fleet is unreachable the instance commits, and the next report shows the backlog', async () => {
  const { fleet, view, code } = await startFleet();
  const { agent, link, addNote } = await startInstance(fleet.url, { code: await code() });
  await agent.sync();
  const reports = agent.status().reports;
  link.offline = true;
  for (const text of ['a', 'b', 'c']) await addNote(text);
  await agent.sync();
  expect(agent.status().lastError).toContain('unreachable');
  expect(agent.status().reports).toBe(reports);
  expect(onlyInstance(await view()).report!.outbox.pending).toBe(0);

  link.offline = false;
  await agent.sync();
  expect(agent.status().lastError).toBeUndefined();
  expect(onlyInstance(await view()).report!.outbox).toMatchObject({ pending: 3, held: 0 });
});

async function placeholderBundle(directory: string) {
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
  return { out, manifest, key };
}

async function publishRelease(
  command: (operation: string, input: unknown) => Promise<unknown>,
  fleetApp: {
    putBlob(data: Uint8Array, mediaType: string, context: typeof owner): Promise<BlobRef>;
  },
  directory: string,
  options: {
    tamper?: boolean;
    /** A bundle already built, published instead of a placeholder one. */
    bundle?: { out: string; manifest: BundleManifest; key: SigningKey };
  } = {},
) {
  const { out, manifest, key } = options.bundle ?? (await placeholderBundle(directory));
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
    id: `${manifest.application}-${manifest.version}`,
    version: manifest.version,
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
  const corrupted = await startInstance(fleet.url, { code: await code(), trust });
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
  const instance = await startInstance(other.fleet.url, {
    code: await other.code(),
    trust: tampered.trust,
  });
  await instance.agent.sync();
  expect(instance.agent.status().lastError).toContain('signature');
  expect(instance.agent.status().staged).toBeUndefined();
  expect(await readdir(instance.releases)).toEqual([]);
});

test('the relay reaches an operation only with a session the instance issued', async () => {
  const { fleet, command, view, code } = await startFleet();
  const { instance, agent, addNote } = await startInstance(fleet.url, {
    code: await code(),
    relay: true,
  });
  await addNote('relayed');
  await agent.sync();
  const instanceId = Object.keys((await view()).instances)[0]!;
  const ask = async (id: string, headers: Record<string, string>) => {
    await command('fixture.relay.enqueue', {
      instance: instanceId,
      request: {
        id,
        method: 'POST',
        path: '/api/v1/queries/notes.count',
        headers: { 'content-type': 'application/json', ...headers },
        body: Buffer.from(JSON.stringify({ input: {} })).toString('base64'),
      },
    });
    expect(await agent.relay()).toBe(true);
    return onlyInstance(await view()).responses[id]!;
  };

  expect((await ask('anonymous', {})).status).toBe(403);
  // The fleet holds the instance's fleet credential, and it opens nothing on the instance.
  const credential = await Bun.file(
    join(instance.workspacePath, 'fleet-agent', 'credential'),
  ).text();
  expect((await ask('fleet-token', { authorization: `Bearer ${credential}` })).status).toBe(403);

  const session = instance.sessions.create(owner, 60_000);
  const response = await ask('operator', { authorization: `Bearer ${session.token}` });
  expect(response.status).toBe(200);
  expect(JSON.parse(Buffer.from(response.body!, 'base64').toString())).toMatchObject({
    data: { count: 1 },
  });
  expect(Object.keys(response.headers)).not.toContain('set-cookie');
  expect(await agent.relay()).toBe(false);
});

test('the fleet stages an upgrade that the instance installs, migrating its state while effects are pending', async () => {
  const directory = await temporary('upgrade-');
  const prefix = join(directory, 'root');
  const key = await generateSigningKey();
  const requirements = { network: [], devices: [], processes: [] };
  // A release's binary is a script running the instance CLI at its version.
  const build = async (version: 1 | 2) => {
    const payload = join(directory, `payload-${version}`);
    await mkdir(join(payload, 'bin'), { recursive: true });
    const bin = join(payload, 'bin', 'plant');
    const cli = join(import.meta.dir, 'instance-cli.ts');
    await writeFile(
      bin,
      `#!/bin/sh\nFIXTURE_STATE=${version} exec "${process.execPath}" "${cli}" "$@"\n`,
    );
    await chmod(bin, 0o755);
    const out = join(directory, `bundle-${version}`);
    const manifest = await createBundle(
      payload,
      out,
      {
        application: 'plant',
        version: `${version}.0.0`,
        platform: `${process.platform}-${process.arch}`,
        storageSchema: 3,
        catalogDigest: 'a'.repeat(64),
        requirements,
      },
      key,
    );
    return { out, manifest, key };
  };
  const trust = join(directory, 'install-key.pub.json');
  await writeFile(trust, JSON.stringify({ keyId: key.keyId, publicKey: key.publicKey }));
  const policy = join(directory, 'install-policy.json');
  await writeFile(
    policy,
    JSON.stringify({ profile: 'desktop-local', audit: { mode: 'best-effort' } }),
  );
  const install = async (binary: string[], bundle: string, extra: string[] = []) => {
    const child = Bun.spawn(
      [
        ...binary,
        'install',
        bundle,
        '--trust',
        trust,
        '--deployment-policy',
        policy,
        '--service',
        'systemd',
        '--prefix',
        prefix,
        ...extra,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stderr, result: JSON.parse(stdout.trim().split('\n').at(-1) || '{}') };
  };

  // Version 1 is installed by hand, with the instance's approval of its requirements.
  const v1 = await build(1);
  const approval = join(directory, 'approval.json');
  await writeFile(
    approval,
    JSON.stringify({ application: 'plant', requirementsDigest: requirementsDigest(requirements) }),
  );
  const first = await install([join(v1.out, 'files/bin/plant')], v1.out, ['--approval', approval]);
  expect(first).toMatchObject({ code: 0, result: { version: '1.0.0' } });
  const workspace = join(prefix, 'var/lib/tortoise/plant/workspace');

  // Version 1 runs and queues two effects for an ERP it cannot reach; the fleet assigns 2.0.0.
  const { fleet, command, code } = await startFleet();
  const { trust: fleetTrust } = await publishRelease(command, fleet.application, directory, {
    bundle: await build(2),
  });
  const running = await startInstance(fleet.url, {
    code: await code(),
    trust: fleetTrust,
    workspace,
  });
  await running.addNote('first');
  await running.addNote('second');
  await running.agent.sync();
  expect(running.agent.status().staged).toMatchObject({ release: 'plant-2.0.0' });
  await running.instance.close();

  // The installed release installs the staged one: the new binary migrates, then current switches.
  const current = join(prefix, 'opt/tortoise/plant/current/files/bin/plant');
  const upgrade = await install([current], join(running.releases, 'plant-2.0.0'));
  expect(upgrade).toMatchObject({ code: 0, result: { version: '2.0.0', previous: '1.0.0' } });

  const stored = async () => {
    const storage = new SQLiteStorage<Record<string, unknown>>(
      join(workspace, 'workspace.sqlite'),
      () => ({}),
    );
    try {
      return await storage.read(LOCAL_WORKSPACE, async (snapshot) => structuredClone(snapshot));
    } finally {
      await storage.close();
    }
  };
  const migrated = await stored();
  expect(migrated.state.notes).toEqual({ total: 2 });
  expect(migrated.stateVersions?.application?.version).toBe(2);
  // The queued effects wait as version 1 recorded them.
  const effects = (snapshot: typeof migrated) =>
    Object.values(snapshot.effects).map((effect) => [
      effect.status,
      effect.contractVersion,
      effect.payload,
    ]);
  expect(effects(migrated)).toEqual([
    ['pending', '1', { text: 'first' }],
    ['pending', '1', { text: 'second' }],
  ]);

  // Version 2 serves the migrated workspace and records its own contract version.
  const network = fleetNetworkFixture(async () => {
    throw new TypeError('Network is unreachable');
  });
  const upgraded = await startHost(instanceApplication(network, 2), {
    workspacePath: workspace,
    integration: false,
    settings: { 'deployment-policy': running.policy },
  });
  try {
    const added = await upgraded.application.invokeRaw(
      { operation: 'notes.add', input: { text: 'third' }, idempotencyKey: 'third' },
      owner,
    );
    expect(added.result).toEqual({ count: 3 });
  } finally {
    await upgraded.close();
  }
  expect(effects(await stored())).toEqual([
    ['pending', '1', { text: 'first' }],
    ['pending', '1', { text: 'second' }],
    ['pending', '2', { text: 'third' }],
  ]);
});

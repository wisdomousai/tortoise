import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createBundle, generateSigningKey } from '@agent-native/bundle';
import { createClient, createHttpTransport } from '@agent-native/client';
import { createFleetApplication } from '@agent-native/fleet/application';
import type { FleetAgentService } from '@agent-native/fleet-agent/plugin';
import { startHost } from '@agent-native/host/host';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from '@agent-native/kernel/instance';
import { networkCommand } from '@agent-native/network/cli';
import { policyErrors, sitePolicyFor } from '@agent-native/site/policy-file';
import { createTestRequestsSiteApplication } from '../application';
import manifest from '../manifest';
import { publishRelease } from '../publish-release';

const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function temporary(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/** The fleet example on loopback, and its owner's client over HTTP, as a build pipeline uses it. */
async function startFleet() {
  const directory = await temporary('lab-fleet-');
  const policy = join(directory, 'site-policy.json');
  await writeFile(
    policy,
    JSON.stringify({ profile: 'desktop-local', audit: { mode: 'best-effort' } }),
  );
  const fleet = await startHost(createFleetApplication(), {
    workspacePath: join(directory, 'workspace'),
    integration: false,
    settings: { 'site-policy': policy },
  });
  cleanups.push(() => fleet.close());
  const { endpoint, token } = JSON.parse(await readFile(fleet.connectionFile!, 'utf8')) as {
    endpoint: string;
    token: string;
  };
  const client = createClient(createHttpTransport({ baseUrl: endpoint, token }));
  const command = async (operation: string, input: unknown) =>
    (
      await fleet.application.invokeRaw(
        { operation, input, idempotencyKey: crypto.randomUUID() },
        owner,
      )
    ).result as Record<string, any>;
  const query = async (operation: string, input: unknown = {}) =>
    (await fleet.application.queryRaw({ operation, input }, owner)).data as Record<string, any>;
  return { fleet, client, command, query };
}

/** Release files up to the fleet's limit; the guard's default cap of 32 MiB is below a binary. */
const releaseCap = { maxResponseBytes: 268_435_456 };

/**
 * The lab site on loopback with the real network plugin. Its policy binds `fleet` to the fleet's
 * loopback origin, which the guard admits under the isolated default, and the releases folder.
 */
async function startSite(
  fleetUrl: string,
  settings: Record<string, string>,
  binding: Record<string, unknown> = releaseCap,
) {
  const directory = await temporary('lab-site-');
  const releases = join(directory, 'fleet-releases');
  await mkdir(releases);
  const policy = join(directory, 'site-policy.json');
  await writeFile(
    policy,
    JSON.stringify({
      profile: 'desktop-local',
      audit: { mode: 'best-effort' },
      destinations: { fleet: { url: fleetUrl, ...binding } },
      folders: { 'fleet-releases': { path: releases } },
    }),
  );
  const site = await startHost(
    createTestRequestsSiteApplication({ members: { ana: 'technician' }, intervalMs: 3_600_000 }),
    {
      workspacePath: join(directory, 'workspace'),
      integration: false,
      settings: { 'site-policy': policy, ...settings },
    },
  );
  cleanups.push(() => site.close());
  const agent = site.services['fleet-agent'] as FleetAgentService;
  return { site, agent, releases };
}

test('the lab site enrolls, reports to the fleet and forwards its audit log', async () => {
  const { fleet, command, query } = await startFleet();
  const { code } = await command('link.enrollment.create', { label: 'Lab 2', kind: 'field-sync' });
  const { site, agent } = await startSite(fleet.url, { 'fleet-enrollment-code': code });
  await site.application.invokeRaw(
    {
      operation: 'test-request.submit',
      input: {
        sample: 'OS-24-0417',
        transformer: 'TR-40517',
        description: 'Gas alarm after a load increase',
      },
      idempotencyKey: 'submit-1',
    },
    { workspaceId: LOCAL_WORKSPACE, principalId: 'ana' },
  );
  await agent.sync();
  // The first cycle runs when the host opens; this one reports the submitted request's events.
  expect(agent.status()).toMatchObject({ enrolled: true });
  expect(agent.status().lastError).toBeUndefined();

  const [listed] = (await query('site.list')).items as { id: string }[];
  const report = await query('site.get', { id: listed!.id });
  // The base pattern queues no effects, so the outbox the site reports is empty.
  expect(report).toMatchObject({ application: 'test-requests-site', pending: 0, held: 0 });
  expect(report.targets).toEqual([]);
  const events = (await query('audit-event.list', { site: listed!.id })).items as {
    event: unknown;
  }[];
  expect(agent.status().auditForwarded).toBe(events.length);
  expect(JSON.stringify(events.map((item) => item.event))).toContain('test-request.submit');
  expect((await query('fleet.health')).issues).toEqual([]);
});

test('a signed release the fleet assigns is staged only after it verifies against fleet-trust', async () => {
  const { fleet, client, command, query } = await startFleet();
  const key = await generateSigningKey();
  const keys = await temporary('lab-keys-');
  const trust = join(keys, 'key.pub.json');
  await writeFile(trust, JSON.stringify({ keyId: key.keyId, publicKey: key.publicKey }));

  // A bundle as `bun run bundle create` lays it out, with a stand-in binary of a real one's size.
  const build = await temporary('lab-bundle-');
  await mkdir(join(build, 'payload', 'bin'), { recursive: true });
  const binary = new Uint8Array(40 * 1024 * 1024).fill(7);
  await writeFile(join(build, 'payload', 'bin', 'test-requests-site'), binary);
  const bundle = join(build, 'bundle');
  await createBundle(
    join(build, 'payload'),
    bundle,
    {
      application: 'test-requests-site',
      version: '1.1.0',
      platform: 'linux-x64',
      storageSchema: 1,
      catalogDigest: 'a'.repeat(64),
      requirements: { network: [], devices: [], processes: [] },
    },
    key,
  );
  const published = await publishRelease(client, bundle, 'lab-stable');
  expect(published).toMatchObject({ id: '1.1.0', application: 'test-requests-site', files: 1 });

  const { code } = await command('link.enrollment.create', { label: 'Lab 2', kind: 'field-sync' });
  const { agent, releases } = await startSite(fleet.url, {
    'fleet-enrollment-code': code,
    'fleet-trust': trust,
  });
  await agent.sync();
  const [listed] = (await query('site.list')).items as { id: string }[];
  // Before the site is on the channel, nothing is staged.
  expect(await readdir(releases)).toEqual([]);
  await command('site.update', { id: listed!.id, channel: 'lab-stable' });
  await agent.sync();
  expect(agent.status().staged).toMatchObject({ release: '1.1.0', version: '1.1.0' });
  expect(await readdir(releases)).toEqual(['1.1.0']);
  expect((await stat(join(releases, '1.1.0', 'files', 'bin', 'test-requests-site'))).size).toBe(
    binary.byteLength,
  );
  await agent.sync();
  expect((await query('site.get', { id: listed!.id })).staged).toBe('1.1.0');
  expect((await query('fleet.health')).issues).toEqual([]);

  // A site that trusts another publisher's key stages nothing from the same channel.
  const other = await generateSigningKey();
  const otherTrust = join(keys, 'other.pub.json');
  await writeFile(otherTrust, JSON.stringify({ keyId: other.keyId, publicKey: other.publicKey }));
  const second = await command('link.enrollment.create', { label: 'Lab 3', kind: 'field-sync' });
  const untrusting = await startSite(fleet.url, {
    'fleet-enrollment-code': second.code,
    'fleet-trust': otherTrust,
  });
  await untrusting.agent.sync();
  const added = ((await query('site.list')).items as { id: string }[]).find(
    (item) => item.id !== listed!.id,
  );
  await command('site.update', { id: added!.id, channel: 'lab-stable' });
  await untrusting.agent.sync();
  expect(untrusting.agent.status().staged).toBeUndefined();
  expect(untrusting.agent.status().lastError).toBe(
    'The bundle signature is not from a trusted key',
  );
  expect(await readdir(untrusting.releases)).toEqual([]);

  // A site whose fleet binding keeps the guard's default cap cannot download the binary.
  const third = await command('link.enrollment.create', { label: 'Lab 4', kind: 'field-sync' });
  const capped = await startSite(
    fleet.url,
    { 'fleet-enrollment-code': third.code, 'fleet-trust': trust },
    {},
  );
  await capped.agent.sync();
  const known = new Set([listed!.id, added!.id]);
  const fourth = ((await query('site.list')).items as { id: string }[]).find(
    (item) => !known.has(item.id),
  );
  await command('site.update', { id: fourth!.id, channel: 'lab-stable' });
  await capped.agent.sync();
  expect(capped.agent.status().lastError).toContain('RESPONSE_TOO_LARGE');
  expect(await readdir(capped.releases)).toEqual([]);
});

test('the committed site policy passes the site check and exports default-deny rules', async () => {
  const policy = resolve(import.meta.dir, '../site-policy.json');
  const out = join(await temporary('lab-rules-'), 'test-requests-site.nft');
  const resolved = await sitePolicyFor(manifest, policy);
  // `site check` reports the same: no error, and the releases folder missing on this machine.
  expect(policyErrors(resolved)).toEqual([]);
  expect(resolved).toMatchObject({ profile: 'site-hub', mode: 'connected' });
  expect([...resolved.bindings.keys()]).toEqual(['fleet']);
  expect(resolved.findings.map((finding) => finding.code)).toEqual(['FOLDER_MISSING']);
  expect(
    await networkCommand(manifest, [
      'network',
      'export',
      '--site',
      policy,
      '--format',
      'nftables',
      '--out',
      out,
    ]),
  ).toBe(0);
  const rules = await readFile(out, 'utf8');
  expect(rules).toContain('ip daddr 10.30.0.10/32 tcp dport 443 accept comment "fleet"');
  expect(rules).toContain('drop');
});

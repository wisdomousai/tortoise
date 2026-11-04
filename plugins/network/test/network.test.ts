import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  collectRequirements,
  defineHostComponent,
  failClosedAuditMode,
  type AuditRecord,
  type NetworkDestination,
} from '@tortoise/contracts';
import { isolatedPolicy, loadDeploymentPolicy } from '@tortoise/deployment/policy';
import { defineApplication } from '@tortoise/host/application';
import { defineManifest } from '@tortoise/host/manifest';
import { defineHostPlugin } from '@tortoise/host/plugin';
import { definePluginManifest } from '@tortoise/host/plugin-manifest';
import { openPlugins } from '@tortoise/host/plugins/lifecycle';
import { deploymentPlugin } from '@tortoise/deployment/plugin';
import { deploymentPluginManifest } from '@tortoise/deployment/plugin-manifest';
import { exportFormats, exportRules, networkRules } from '../src/index';
import { networkPlugin } from '../src/plugin';
import { networkPluginManifest } from '../src/plugin-manifest';

const fixtures = join(import.meta.dir, 'fixtures');
const golden = join(import.meta.dir, 'golden');
const update = process.env.UPDATE_GOLDEN === '1';

const destination = (id: string, extra: Partial<NetworkDestination> = {}): NetworkDestination => ({
  id,
  purpose: `${id} for tests`,
  direction: 'outbound',
  scope: 'local',
  protocol: 'https',
  dataClasses: ['record'],
  availability: 'optional',
  offline: 'degrade',
  ...extra,
});
// A deployment shaped like the reference app: a required local system, an internet vendor, an
// off-host audit collector, a loopback model, an optional HMI and a child process. The host's
// own listener comes from the host components the plugin tests compose.
const plant = defineHostComponent({
  id: 'plant',
  description: 'Test host component',
  requirements: {
    network: [
      destination('mes-api', { availability: 'required', offline: 'queue', targets: ['mes'] }),
      destination('vendor-api', { scope: 'internet', host: 'api.vendor.example' }),
      destination('audit-collector', { protocol: 'tcp', dataClasses: ['audit-event'] }),
      destination('local-model', { scope: 'loopback', protocol: 'http', dataClasses: [] }),
      destination('station-screen', { dataClasses: ['screen-frame'] }),
    ],
    processes: [
      {
        id: 'agent-cli',
        executable: 'agent',
        purpose: 'Vendor agent process',
        availability: 'optional',
        network: ['vendor-api'],
      },
    ],
  },
});
const requirements = collectRequirements([plant]);
const sandboxPolicy = () =>
  loadDeploymentPolicy(join(fixtures, 'deployment-policy.sandbox.json'), requirements);
const exportOptions = {
  user: 'tortoise',
  uid: 10001,
  executable: '/opt/tortoise/service',
  workspace: '/var/lib/tortoise/workspace',
  auditLog: '/var/lib/tortoise/audit',
  deploymentPolicy: '/etc/tortoise/deployment-policy.json',
  image: 'registry.plant.local/tortoise:1.0.0',
};
const extensions: Record<(typeof exportFormats)[number], string> = {
  json: 'json',
  nftables: 'nft',
  'windows-firewall': 'ps1',
  'k8s-networkpolicy': 'yaml',
  'k8s-pod': 'yaml',
  compose: 'yaml',
  systemd: 'service',
};

describe('network rules', () => {
  test('the sample sandbox policy is usable and flags its hostname-only binding', async () => {
    const policy = await sandboxPolicy();
    expect(policy.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(policy.findings).toContainEqual(
      expect.objectContaining({ code: 'HOSTNAME_ONLY', destination: 'vendor-api' }),
    );
  });

  test('only bound, addressable, non-loopback destinations become allow rules', async () => {
    const rules = networkRules(await sandboxPolicy(), {
      application: 'tortoise',
      resolvers: ['10.20.0.53'],
      processes: requirements.processes,
    });
    expect(rules.defaultNetwork).toBe('deny');
    expect(rules.allow.map((rule) => [rule.destination, rule.transport, rule.port])).toEqual([
      ['audit-collector', 'tcp', 6514],
      ['mes-api', 'tcp', 8443],
    ]);
    expect(rules.allow.find((rule) => rule.destination === 'mes-api')!.addresses).toEqual([
      '10.20.0.15/32',
      'fd00:20::15/128',
    ]);
    // Hostname-only is reported, never widened to "any address on 443".
    expect(rules.unresolved).toEqual([
      { destination: 'vendor-api', host: 'api.vendor.example', reason: 'HOSTNAME_ONLY' },
    ]);
    expect(rules.dns).toEqual({ resolvers: ['10.20.0.53'], needed: true });
  });

  test('the isolated default exports loopback only', () => {
    const rules = networkRules(isolatedPolicy(requirements), { application: 'tortoise' });
    expect(rules.allow).toEqual([]);
    expect(rules.unresolved).toEqual([]);
    expect(exportRules(rules, 'systemd', exportOptions)).toContain('IPAddressDeny=any');
  });

  for (const format of exportFormats)
    test(`${format} export matches the golden file`, async () => {
      const rules = networkRules(await sandboxPolicy(), {
        application: 'tortoise',
        resolvers: ['10.20.0.53'],
        processes: requirements.processes,
      });
      const text = exportRules(rules, format, exportOptions);
      const path = join(golden, `sandbox.${format}.${extensions[format]}`);
      if (update || !existsSync(path)) await writeFile(path, text);
      expect(text).toBe(await readFile(path, 'utf8'));
      // Every format states the unenforceable gap instead of dropping it silently.
      if (format !== 'json') expect(text).toContain('NOT ENFORCED: vendor-api');
    });
});

describe('network plugin', () => {
  // An event-log provider composed after the network plugin, so the guard can only reach it
  // through the composed ports.
  const recorded: AuditRecord[] = [];
  const recorderManifest = definePluginManifest({ id: 'recorder', title: 'Recorder' });
  const recorder = defineHostPlugin({
    manifest: recorderManifest,
    open: async () => ({
      ports: {
        eventLog: {
          mode: failClosedAuditMode,
          append: async (records) => {
            recorded.push(...records);
            return [];
          },
        },
      },
    }),
  });
  const plugins = [deploymentPlugin, networkPlugin, recorder];
  const definition = defineApplication({
    manifest: defineManifest({
      id: 'plant',
      title: 'Plant',
      modules: [],
      components: [plant],
      plugins: [deploymentPluginManifest, networkPluginManifest, recorderManifest],
    }),
    createState: () => ({}),
    handlers: [],
    authorization: { authorize: () => ({ allowed: false }), canReadEvent: () => false },
    plugins,
  });
  const options = { workspacePath: '/tmp/unused', component: 'embedded', instance: 't' } as const;

  test('the guard refuses unbound destinations and records into a later event log', async () => {
    const opened = await openPlugins(definition, { ...options, serving: false });
    await expect(opened.ports.network.client('mes-api').fetch('/')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(recorded).toContainEqual(
      expect.objectContaining({ kind: 'network.denied', data: { destination: 'mes-api' } }),
    );
    // Not serving: no proxy, so declared children are refused rather than left unconfined.
    expect(() => opened.ports.network.childEnvironment!('agent-cli')).toThrow('serving host');
    expect(opened.describe()).toMatchObject({ network: { mode: 'isolated', ingress: 'loopback' } });
    await opened.close();
  });

  test('a policy that binds destinations refuses to start without the network plugin', async () => {
    const policy = join(await mkdtemp(join(tmpdir(), 'network-')), 'deployment-policy.json');
    await writeFile(
      policy,
      JSON.stringify({
        profile: 'desktop-local',
        mode: 'connected',
        destinations: { 'mes-api': { disabled: true, reason: 'Not on this line.' } },
        audit: { mode: 'best-effort' },
      }),
    );
    const withoutNetwork = defineApplication({
      ...definition,
      manifest: defineManifest({
        id: 'plant',
        title: 'Plant',
        modules: [],
        components: [plant],
        plugins: [deploymentPluginManifest],
      }),
      plugins: [deploymentPlugin],
    });
    const settings = { 'deployment-policy': policy };
    await expect(
      openPlugins(withoutNetwork, { ...options, serving: false, settings }),
    ).rejects.toThrow('Plugin "deployment" is configured to need the network port');
    const opened = await openPlugins(definition, { ...options, serving: false, settings });
    await opened.close();
    await rm(dirname(policy), { recursive: true, force: true });
  });
});

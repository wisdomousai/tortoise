import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditEventKinds,
  buildCatalog,
  collectRequirements,
  defineHostComponent,
  type NetworkDestination,
} from '@agent-native/contracts';
import { loadSitePolicy, isolatedPolicy } from '@agent-native/egress';
import { openJsonlEventLog, verifyEventLog } from '@agent-native/event-log';
import { createApplication, createMemoryStorage } from '@agent-native/runtime';
import {
  directDriver,
  runScenarios,
  type BehavioralScenario,
  type ScenarioDriver,
} from '@agent-native/testing';
import {
  accumulateEgress,
  assessPosture,
  controls,
  controlsMarkdown,
  createPostureMonitor,
  cycloneDx,
  dataFlowsMarkdown,
  exportFormats,
  exportRules,
  networkRules,
  securityManifest,
  type AssurancePort,
} from '../src/index';
import {
  assuranceModule,
  assurancePolicy,
  createAssuranceHandlers,
  createAssuranceState,
} from '../src/server';

const root = join(import.meta.dir, '../../..');
const fixtures = join(import.meta.dir, 'fixtures');
const golden = join(import.meta.dir, 'golden');
const update = process.env.UPDATE_GOLDEN === '1';
const temporary: string[] = [];
afterAll(() => Promise.all(temporary.map((path) => rm(path, { recursive: true, force: true }))));
async function tempDir() {
  const path = await mkdtemp(join(tmpdir(), 'assurance-'));
  temporary.push(path);
  return path;
}

const destination = (id: string, extra: Partial<NetworkDestination> = {}): NetworkDestination => ({
  id,
  purpose: `${id} for tests`,
  direction: 'egress',
  scope: 'site',
  protocol: 'https',
  dataClasses: ['record'],
  availability: 'optional',
  offline: 'degrade',
  ...extra,
});
// A deployment shaped like the reference app: a required site system, an internet vendor, an
// off-host audit collector, a loopback model, an optional HMI and a child process.
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
      destination('authority-http', {
        direction: 'ingress',
        scope: 'loopback',
        protocol: 'http',
        dataClasses: [],
        availability: 'required',
        offline: 'unavailable',
      }),
    ],
    devices: [{ id: 'scanner', kind: 'hid', purpose: 'Barcode scanner', availability: 'optional' }],
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
  loadSitePolicy(join(fixtures, 'site-policy.sandbox.json'), requirements);
const exportOptions = {
  user: 'agent-native',
  uid: 10001,
  executable: '/opt/agent-native/service',
  workspace: '/var/lib/agent-native/workspace',
  auditLog: '/var/lib/agent-native/audit',
  sitePolicy: '/etc/agent-native/site-policy.json',
  image: 'registry.plant.local/agent-native:1.0.0',
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
      application: 'agent-native',
      resolvers: ['10.20.0.53'],
      processes: requirements.processes,
    });
    expect(rules.defaultEgress).toBe('deny');
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
    const rules = networkRules(isolatedPolicy(requirements), { application: 'agent-native' });
    expect(rules.allow).toEqual([]);
    expect(rules.unresolved).toEqual([]);
    expect(exportRules(rules, 'systemd', exportOptions)).toContain('IPAddressDeny=any');
  });

  for (const format of exportFormats)
    test(`${format} export matches the golden file`, async () => {
      const rules = networkRules(await sandboxPolicy(), {
        application: 'agent-native',
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

describe('generated assurance artifacts', () => {
  const catalog = buildCatalog([assuranceModule], { components: [plant] });

  test('the manifest lists every declaration with its owner', () => {
    const manifest = securityManifest({
      application: 'agent-native',
      catalog,
      components: [plant],
    });
    expect(manifest.owners).toContainEqual({
      id: 'plant',
      kind: 'component',
      description: 'Test host component',
    });
    expect(manifest.summary).toEqual({
      egress: 5,
      ingress: 1,
      internet: ['vendor-api'],
      required: ['authority-http', 'mes-api'],
      dataClasses: ['audit-event', 'record', 'screen-frame'],
    });
    const markdown = dataFlowsMarkdown(manifest);
    expect(markdown).toContain('```mermaid');
    expect(markdown).toContain('proc_agent_cli -. may reach .-> vendor_api');
    expect(markdown).toContain('| `scanner` | plant | hid |');
  });

  const lock = `{
    "lockfileVersion": 1,
    "workspaces": {
      "": { "name": "root", "dependencies": { "a": "^1" }, "devDependencies": { "d": "^3" }, },
      "packages/x": { "name": "@scope/x", "dependencies": { "@scope/b": "^2" }, },
    },
    "packages": {
      "@scope/x": ["@scope/x@workspace:packages/x"],
      "@scope/b": ["@scope/b@2.0.0", "", {}, "sha512-q83v"],
      "a": ["a@1.0.0", "", { "dependencies": { "c": "^1" } }, "sha512-AAAA"],
      "c": ["c@1.2.0", "", {}, "sha256-BBBB"],
      "d": ["d@3.0.0", "", { "dependencies": { "c": "^2" } }, "sha512-DDDD"],
      "d/c": ["c@2.0.0", "", {}, "sha512-EEEE"],
    },
  }`;

  test('the SBOM is deterministic CycloneDX 1.6 with runtime scope from the lock', async () => {
    const manifest = securityManifest({
      application: 'agent-native',
      catalog,
      components: [plant],
    });
    const bom = cycloneDx({ application: 'agent-native', version: '1.0.0', lock, manifest }) as any;
    expect(cycloneDx({ application: 'agent-native', version: '1.0.0', lock, manifest })).toEqual(
      bom,
    );
    expect(bom).toMatchObject({ bomFormat: 'CycloneDX', specVersion: '1.6', version: 1 });
    expect(bom.serialNumber).toMatch(
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(JSON.stringify(bom)).not.toContain('timestamp');
    const scope = Object.fromEntries(
      bom.components.map((item: any) => [item['bom-ref'], item.scope]),
    );
    expect(scope).toEqual({
      'pkg:npm/%40scope/b@2.0.0': 'required',
      'pkg:npm/a@1.0.0': 'required',
      'pkg:npm/c@1.2.0': 'required',
      'pkg:npm/c@2.0.0': 'excluded',
      'pkg:npm/d@3.0.0': 'excluded',
      'workspace:@scope/x': 'excluded',
    });
    expect(
      bom.components.find((item: any) => item.name === 'c' && item.version === '1.2.0'),
    ).toMatchObject({ hashes: [{ alg: 'SHA-256', content: '041041' }] });
    expect(bom.dependencies).toContainEqual({
      ref: 'pkg:npm/d@3.0.0',
      dependsOn: ['pkg:npm/c@2.0.0'],
    });
    expect(bom.dependencies).toContainEqual({
      ref: 'application:agent-native@1.0.0',
      dependsOn: ['pkg:npm/%40scope/b@2.0.0', 'pkg:npm/a@1.0.0', 'pkg:npm/d@3.0.0'],
    });
    expect(bom.services.map((item: any) => item['bom-ref'])).toContain('service:vendor-api');
    expect(bom.services.find((item: any) => item.name === 'vendor-api')).toMatchObject({
      endpoints: ['https://api.vendor.example'],
      trustZone: 'internet',
      'x-trust-boundary': true,
      data: [{ flow: 'outbound', classification: 'record' }],
    });
  });

  test('the published SBOM covers the repository lock', async () => {
    const bom = JSON.parse(await readFile(join(root, 'docs/reference/sbom.cdx.json'), 'utf8'));
    expect(bom.components.length).toBeGreaterThan(100);
    expect(
      bom.components.every((item: any) => item.purl || item['bom-ref'].startsWith('workspace:')),
    ).toBe(true);
    expect(bom.components.some((item: any) => item.scope === 'required')).toBe(true);
  });

  test('every control has stable identity, a mapping and evidence that exists', () => {
    const ids = controls.map((control) => control.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const control of controls) {
      expect(control.id).toMatch(/^AN-[A-Z]{3}-\d{2}$/);
      const { iso27001, nist80053, csf } = control.mappings;
      expect(iso27001.length + nist80053.length + csf.length).toBeGreaterThan(0);
      expect(control.evidence.tests.length + control.evidence.artifacts.length).toBeGreaterThan(0);
      for (const file of control.evidence.tests) expect(existsSync(join(root, file))).toBe(true);
      for (const artifact of control.evidence.artifacts)
        if (artifact.startsWith('docs/')) expect(existsSync(join(root, artifact))).toBe(true);
      for (const kind of control.evidence.events) expect(kind in auditEventKinds).toBe(true);
    }
    expect(controlsMarkdown()).toContain('### IEC 62443-4-2');
  });
});

describe('posture', () => {
  test('denials ask for attention; a broken chain fails', async () => {
    const policy = await sandboxPolicy();
    const usage = accumulateEgress(new Map(), [
      { kind: 'egress.allowed', outcome: 'allowed', at: 5, data: { destination: 'mes-api' } },
      { kind: 'egress.denied', outcome: 'denied', at: 6, data: { destination: 'vendor-api' } },
    ] as any);
    const posture = assessPosture({ policy, usage, now: 10 });
    expect(posture.status).toBe('attention');
    expect(posture.checks.find((check) => check.id === 'egress-denials')!.summary).toBe(
      'Denied egress to vendor-api (1)',
    );
    const state = Object.fromEntries(posture.destinations.map((item) => [item.id, item.state]));
    expect(state).toEqual({
      'audit-collector': 'bound',
      'authority-http': 'local',
      'local-model': 'bound',
      'mes-api': 'bound',
      'station-screen': 'disabled',
      'vendor-api': 'bound',
    });
    expect(posture.destinations.find((item) => item.id === 'mes-api')).toMatchObject({
      origin: 'https://mes.plant.local:8443',
      allowed: 1,
      lastUsedAt: 5,
    });
    const broken = assessPosture({
      policy,
      verification: {
        ok: false,
        segments: 1,
        events: 2,
        checkpoints: 0,
        problems: [{ segment: 'x', line: 2, problem: 'hash mismatch' }],
      } as any,
      now: 10,
    });
    expect(broken.status).toBe('failing');
  });
});

/** A live log with denials, deep data and a monitor reading it, as the host wires it. */
async function monitoredLog() {
  const directory = await tempDir();
  const log = await openJsonlEventLog({
    directory,
    source: { component: 'test', instance: 'one' },
  });
  await log.append([
    { kind: 'egress.allowed', outcome: 'allowed', data: { destination: 'mes-api' } },
    { kind: 'egress.denied', outcome: 'denied', reason: 'UNBOUND', data: { destination: 'x' } },
    {
      kind: 'command.denied',
      outcome: 'denied',
      operation: 'inspection.lot.release',
      reason: 'FORBIDDEN',
      data: { fields: ['lot'], deep: { level: { too: { far: 1 } } } },
    },
    { kind: 'query.executed', outcome: 'allowed', operation: 'inspection.lot.list' },
  ]);
  const monitor = createPostureMonitor({
    policy: await sandboxPolicy(),
    directory,
    head: () => log.head(),
    eventLog: log,
    attestation: async () => ({ catalogDigest: 'c'.repeat(64) }),
  });
  return { directory, log, monitor };
}

describe('posture monitor', () => {
  test('checks verify the live chain, fold egress and record posture.checked', async () => {
    const { directory, log, monitor } = await monitoredLog();
    const posture = await monitor.check();
    expect(posture.log).toMatchObject({ verified: true, problems: 0 });
    expect(posture.catalogDigest).toBe('c'.repeat(64));
    expect(posture.destinations.find((item) => item.id === 'mes-api')!.allowed).toBe(1);
    // Concurrent readers within the freshness window reuse the check.
    expect(await monitor.posture()).toBe(posture);
    const checked = await monitor.events({ kinds: ['posture.checked'] });
    expect(checked.items).toHaveLength(1);
    expect(checked.items[0]!.data).toMatchObject({ status: posture.status });
    await monitor.stop();
    await log.close();
    expect((await verifyEventLog(directory)).ok).toBe(true);
  });

  test('event pages filter by outcome, read newest first and bound nested data', async () => {
    const { log, monitor } = await monitoredLog();
    const denied = await monitor.events({ outcome: 'denied', limit: 1 });
    expect(denied.items.map((event) => event.kind)).toEqual(['egress.denied']);
    const next = await monitor.events({
      outcome: 'denied',
      limit: 1,
      afterSeq: denied.nextAfterSeq,
    });
    expect(next.items.map((event) => event.kind)).toEqual(['command.denied']);
    // The published schema has two levels; deeper values arrive as JSON text.
    expect(next.items[0]!.data).toEqual({
      fields: ['lot'],
      deep: { level: '{"too":{"far":1}}' },
    });
    const newest = await monitor.events({
      kinds: ['egress.denied', 'command.denied'],
      newest: true,
      limit: 1,
    });
    expect(newest.items.map((event) => event.kind)).toEqual(['command.denied']);
    expect(newest.headSeq).toBe(log.head().seq);
    expect(await monitor.verify()).toMatchObject({ ok: true, headSeq: log.head().seq });
    await log.close();
  });
});

const auditor = { workspaceId: 'plant', principalId: 'auditor' };
const viewer = { workspaceId: 'plant', principalId: 'vic' };
const rejects = async (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code });

/** Reusable across transports: the operations are read-only and auditor-only. */
const assuranceScenarios: BehavioralScenario[] = [
  {
    name: 'an auditor reads posture, events and chain status',
    async run(driver) {
      const posture = (
        await driver.query({ operation: 'assurance.posture.get', input: {} }, auditor)
      ).data as { profile: string; log: { verified: boolean } };
      expect(posture).toMatchObject({ profile: 'sandbox', log: { verified: true } });
      const events = (
        await driver.query(
          { operation: 'assurance.events.list', input: { outcome: 'denied', limit: 10 } },
          auditor,
        )
      ).data as { items: { kind: string }[] };
      expect(events.items.map((event) => event.kind)).toEqual(['egress.denied', 'command.denied']);
      const verification = (
        await driver.query({ operation: 'assurance.log.verify', input: {} }, auditor)
      ).data as { ok: boolean };
      expect(verification.ok).toBe(true);
    },
  },
  {
    name: 'a non-auditor is refused every assurance read',
    async run(driver) {
      for (const operation of [
        'assurance.posture.get',
        'assurance.events.list',
        'assurance.log.verify',
      ])
        await rejects(driver.query({ operation, input: {} }, viewer), 'FORBIDDEN');
    },
  },
  {
    name: 'a delegated grant must name the operation and, if resource-limited, the audit log',
    async run(driver: ScenarioDriver) {
      const operations = ['assurance.events.list'];
      await rejects(
        driver.query(
          { operation: 'assurance.events.list', input: {} },
          { ...auditor, grant: { operations, resources: ['inspection:lot:L1'] } },
        ),
        'FORBIDDEN',
      );
      await rejects(
        driver.query(
          { operation: 'assurance.posture.get', input: {} },
          { ...auditor, grant: { operations, resources: ['audit:log'] } },
        ),
        'FORBIDDEN',
      );
      const allowed = await driver.query(
        { operation: 'assurance.events.list', input: { limit: 1 } },
        { ...auditor, grant: { operations, resources: ['audit:log'] } },
      );
      expect((allowed.data as { items: unknown[] }).items).toHaveLength(1);
    },
  },
];

function assuranceApplication(assurance?: AssurancePort) {
  return createApplication({
    modules: [assuranceModule],
    handlers: createAssuranceHandlers(),
    storage: createMemoryStorage(createAssuranceState(['auditor'])),
    authorization: assurancePolicy,
    services: assurance ? { assurance } : {},
  });
}

describe('assurance capabilities', () => {
  test('behavioural scenarios through the direct driver', async () => {
    const { log, monitor } = await monitoredLog();
    await runScenarios(assuranceScenarios, directDriver(assuranceApplication(monitor)));
    await log.close();
  });

  test('a host without an audit log reports unavailable, not empty', async () => {
    const app = assuranceApplication();
    await rejects(
      app.queryRaw({ operation: 'assurance.posture.get', input: {} }, auditor),
      'UNAVAILABLE',
    );
  });
});

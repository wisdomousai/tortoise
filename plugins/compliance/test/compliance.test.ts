import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditEventKinds,
  buildCatalog,
  collectRequirements,
  defineCapability,
  defineHostComponent,
  defineModule,
  jsonSchema,
  type NetworkDestination,
} from '@agent-native/contracts';
import { z } from 'zod';
import { loadSitePolicy } from '@agent-native/site/policy';
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
  securityManifest,
  type CompliancePort,
} from '../src/index';
import {
  complianceModule,
  compliancePolicy,
  createComplianceHandlers,
  createComplianceState,
} from '../src/server';

const root = join(import.meta.dir, '../../..');
const fixtures = join(import.meta.dir, 'fixtures');
const temporary: string[] = [];
afterAll(() => Promise.all(temporary.map((path) => rm(path, { recursive: true, force: true }))));
async function tempDir() {
  const path = await mkdtemp(join(tmpdir(), 'compliance-'));
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
      destination('host-http', {
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
describe('generated compliance artifacts', () => {
  const catalog = buildCatalog([complianceModule], { components: [plant] });

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
      site: ['audit-collector', 'mes-api', 'scanner', 'station-screen'],
      required: ['host-http', 'mes-api'],
      dataClasses: ['audit-event', 'record', 'screen-frame'],
    });
    const markdown = dataFlowsMarkdown(manifest);
    expect(markdown).toContain('```mermaid');
    expect(markdown).toContain('proc_agent_cli -. may reach .-> vendor_api');
    expect(markdown).toContain('| `scanner` | plant | hid |');
    expect(manifest.os).toEqual({ handlers: [], actions: [] });
    expect(markdown).not.toContain('## OS handlers and actions');
  });

  test('an outbox target carried by a child process is listed as a flow through that process, and a command invoking it as nested', () => {
    const forward = defineCapability({
      id: 'chamber.setpoint.set',
      kind: 'command',
      input: jsonSchema(z.strictObject({})),
      output: jsonSchema(z.strictObject({})),
      permission: { action: 'update', resourceType: 'Chamber' },
      ui: { exception: 'test' },
      integration: { target: 'chamber', delivery: 'outbox' },
    });
    const driver = defineHostComponent({
      id: 'driver.chamber',
      description: 'Test chamber driver',
      requirements: {
        processes: [
          {
            id: 'chamber-driver',
            executable: 'configured',
            purpose: 'Drives the test chamber',
            availability: 'optional',
            targets: ['chamber'],
          },
        ],
      },
    });
    const manifest = securityManifest({
      application: 'agent-native',
      catalog: buildCatalog(
        [
          defineModule({
            id: 'chamber',
            capabilities: [
              forward,
              {
                ...forward,
                id: 'chamber.cycle',
                integration: undefined,
                invokes: ['chamber.setpoint.set'],
              },
            ],
          }),
        ],
        { components: [driver] },
      ),
      components: [driver],
    });
    expect(manifest.flows).toEqual([
      {
        operation: 'chamber.cycle',
        kind: 'command',
        module: 'chamber',
        path: 'nested',
        invokes: ['chamber.setpoint.set'],
        destinations: [],
        processes: ['chamber-driver'],
        dataClasses: [],
        auditFields: [],
      },
      {
        operation: 'chamber.setpoint.set',
        kind: 'command',
        module: 'chamber',
        target: 'chamber',
        path: 'outbox',
        destinations: [],
        processes: ['chamber-driver'],
        dataClasses: [],
        auditFields: [],
      },
    ]);
    expect(dataFlowsMarkdown(manifest)).toContain(
      '| `chamber.setpoint.set` | chamber | outbox | process `chamber-driver` |',
    );
    expect(dataFlowsMarkdown(manifest)).toContain(
      '| `chamber.cycle` | via `chamber.setpoint.set` | nested | process `chamber-driver` |',
    );
  });

  test('OS handlers are listed as local ingress and OS actions with their data classes', () => {
    const opener = defineHostComponent({
      id: 'docs-opener',
      description: 'Opens documentation.',
      requirements: {},
      os: {
        actions: [
          {
            id: 'docs.open',
            kind: 'open',
            description: 'Open the documentation.',
            url: 'https://docs.example.com/guide',
            dataClasses: ['docs-link'],
          },
        ],
      },
    });
    const withOs = buildCatalog([complianceModule], { components: [plant, opener] });
    const manifest = securityManifest({
      application: 'agent-native',
      catalog: withOs,
      components: [plant, opener],
    });
    expect(manifest.os.actions).toEqual([
      {
        id: 'docs.open',
        owner: 'docs-opener',
        kind: 'open',
        reaches: 'https://docs.example.com/guide',
        dataClasses: ['docs-link'],
      },
    ]);
    expect(manifest.summary.dataClasses).toContain('docs-link');
    expect(dataFlowsMarkdown(manifest)).toContain(
      '| `docs.open` | docs-opener | open | https://docs.example.com/guide | docs-link |',
    );
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

  test('an SBOM of the repository lock covers every package', async () => {
    const bom = cycloneDx({
      application: 'quality-inspection',
      version: '0.0.0',
      lock: await readFile(join(root, 'bun.lock'), 'utf8'),
    }) as any;
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
      'host-http': 'local',
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

  test('certificates are judged at each check, so one that expires while running fails', async () => {
    const policy = await sandboxPolicy();
    expect(assessPosture({ policy, now: 10 }).checks).toContainEqual({
      id: 'certificates',
      status: 'info',
      summary: 'No certificates are configured',
    });
    const notAfter = Date.UTC(2031, 0, 1);
    const withCertificate = {
      ...policy,
      certificates: [
        {
          source: 'ingress-cert' as const,
          subject: 'CN=hub',
          fingerprint256: 'AA',
          notBefore: Date.UTC(2030, 0, 1),
          notAfter,
        },
      ],
    };
    const check = (now: number) =>
      assessPosture({ policy: withCertificate, now }).checks.find(
        (item) => item.id === 'certificates',
      )!;
    expect(check(notAfter - 90 * 86_400_000).status).toBe('pass');
    expect(check(notAfter - 5 * 86_400_000)).toMatchObject({ status: 'warn' });
    expect(check(notAfter + 1)).toMatchObject({ status: 'fail' });
    expect(assessPosture({ policy: withCertificate, now: notAfter + 1 }).status).toBe('failing');
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
const complianceScenarios: BehavioralScenario[] = [
  {
    name: 'an auditor reads posture, events and chain status',
    async run(driver) {
      const posture = (
        await driver.query({ operation: 'compliance.posture.get', input: {} }, auditor)
      ).data as { profile: string; log: { verified: boolean } };
      expect(posture).toMatchObject({ profile: 'sandbox', log: { verified: true } });
      const events = (
        await driver.query(
          { operation: 'compliance.events.list', input: { outcome: 'denied', limit: 10 } },
          auditor,
        )
      ).data as { items: { kind: string }[] };
      expect(events.items.map((event) => event.kind)).toEqual(['egress.denied', 'command.denied']);
      const verification = (
        await driver.query({ operation: 'compliance.log.verify', input: {} }, auditor)
      ).data as { ok: boolean };
      expect(verification.ok).toBe(true);
    },
  },
  {
    name: 'a non-auditor is refused every compliance read',
    async run(driver) {
      for (const operation of [
        'compliance.posture.get',
        'compliance.events.list',
        'compliance.log.verify',
      ])
        await rejects(driver.query({ operation, input: {} }, viewer), 'FORBIDDEN');
    },
  },
  {
    name: 'a delegated grant must name the operation and, if resource-limited, the audit log',
    async run(driver: ScenarioDriver) {
      const operations = ['compliance.events.list'];
      await rejects(
        driver.query(
          { operation: 'compliance.events.list', input: {} },
          { ...auditor, grant: { operations, resources: ['inspection:lot:L1'] } },
        ),
        'FORBIDDEN',
      );
      await rejects(
        driver.query(
          { operation: 'compliance.posture.get', input: {} },
          { ...auditor, grant: { operations, resources: ['audit:log'] } },
        ),
        'FORBIDDEN',
      );
      const allowed = await driver.query(
        { operation: 'compliance.events.list', input: { limit: 1 } },
        { ...auditor, grant: { operations, resources: ['audit:log'] } },
      );
      expect((allowed.data as { items: unknown[] }).items).toHaveLength(1);
    },
  },
];

function complianceApplication(compliance?: CompliancePort) {
  return createApplication({
    modules: [complianceModule],
    handlers: createComplianceHandlers(),
    storage: createMemoryStorage(createComplianceState(['auditor'])),
    authorization: compliancePolicy,
    services: compliance ? { compliance } : {},
  });
}

describe('compliance capabilities', () => {
  test('behavioural scenarios through the direct driver', async () => {
    const { log, monitor } = await monitoredLog();
    await runScenarios(complianceScenarios, directDriver(complianceApplication(monitor)));
    await log.close();
  });

  test('a host without an audit log reports unavailable, not empty', async () => {
    const app = complianceApplication();
    await rejects(
      app.queryRaw({ operation: 'compliance.posture.get', input: {} }, auditor),
      'UNAVAILABLE',
    );
  });
});

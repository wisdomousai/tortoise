import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectRequirements, type NetworkDestination } from '@agent-native/contracts';
import { cidrContains, parseCidr } from '../src/cidr';
import {
  assertPolicyUsable,
  isolatedPolicy,
  loadSitePolicy,
  resolveSitePolicy,
  type SitePolicyInput,
} from '../src/policy';

const site = (id: string, extra: Partial<NetworkDestination> = {}): NetworkDestination => ({
  id,
  purpose: 'test',
  direction: 'egress',
  scope: 'site',
  protocol: 'https',
  dataClasses: ['record'],
  availability: 'optional',
  offline: 'degrade',
  ...extra,
});
const requirements = collectRequirements([
  {
    id: 'app',
    requirements: {
      network: [
        site('mes-api', { availability: 'required', targets: ['mes'], offline: 'queue' }),
        site('station-screen'),
        site('vendor-api', { scope: 'internet', host: 'api.vendor.example' }),
        site('local-model', { scope: 'loopback', protocol: 'http', dataClasses: [] }),
        site('legacy-tcp', { protocol: 'tcp' }),
        site('loopback-tcp', { scope: 'loopback', protocol: 'tcp', dataClasses: [] }),
        site('workforce-idp', { scope: 'internet', dataClasses: ['identity'] }),
      ],
      processes: [
        {
          id: 'agent-cli',
          executable: 'agent',
          purpose: 'test',
          availability: 'optional',
          network: ['loopback-tcp'],
        },
      ],
    },
  },
]);
const policy = (input: SitePolicyInput) => resolveSitePolicy(input, requirements);
const codes = (input: SitePolicyInput) =>
  policy(input)
    .findings.filter((finding) => finding.level === 'error')
    .map((finding) => finding.code);

describe('addresses', () => {
  test('CIDR matching covers IPv4, IPv6 and mapped addresses', () => {
    expect(cidrContains(parseCidr('10.20.0.0/16'), '10.20.3.4')).toBe(true);
    expect(cidrContains(parseCidr('10.20.0.0/16'), '10.21.0.1')).toBe(false);
    expect(cidrContains(parseCidr('10.20.0.15'), '::ffff:10.20.0.15')).toBe(true);
    expect(cidrContains(parseCidr('fd00::/8'), 'fd12::1')).toBe(true);
    expect(cidrContains(parseCidr('fd00::/8'), 'fe80::1')).toBe(false);
    expect(() => parseCidr('10.0.0.0/33')).toThrow();
    expect(() => parseCidr('mes.local')).toThrow();
  });
});

describe('site policy', () => {
  test('no policy means isolated: everything off-host is a listed consequence, not an error', () => {
    const resolved = isolatedPolicy(requirements);
    expect(resolved.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(resolved.consequences.find((item) => item.destination === 'mes-api')).toMatchObject({
      reason: 'isolated',
      offline: 'queue',
      targets: ['mes'],
    });
  });

  test('bindings must match declarations and the connected deployment must decide every required one', () => {
    expect(codes({ mode: 'connected', destinations: { nowhere: { url: 'https://x' } } })).toEqual([
      'UNDECLARED_BINDING',
      'REQUIRED_UNBOUND',
    ]);
    expect(
      codes({
        mode: 'connected',
        destinations: {
          'mes-api': { url: 'http://mes.plant:80' },
          'local-model': { url: 'http://10.0.0.5:11434' },
        },
      }),
    ).toEqual(['PROTOCOL_MISMATCH', 'SCOPE_MISMATCH']);
    expect(
      codes({ mode: 'connected', destinations: { 'mes-api': { url: 'https://u:p@mes.plant' } } }),
    ).toContain('CREDENTIALS_IN_URL');
    expect(
      codes({ mode: 'isolated', destinations: { 'mes-api': { url: 'https://mes.plant' } } }),
    ).toContain('ISOLATED_BINDING');
    const disabled = policy({ mode: 'connected', destinations: { 'mes-api': { disabled: true } } });
    expect(disabled.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(disabled.consequences.map((item) => item.destination)).toContain('local-model');
    expect(disabled.consequences.find((item) => item.destination === 'mes-api')?.reason).toBe(
      'disabled',
    );
  });

  test('hostname-only bindings are flagged for firewall export and rebinding', () => {
    const resolved = policy({
      mode: 'connected',
      destinations: { 'mes-api': { url: 'https://mes.plant' } },
    });
    expect(resolved.findings.map((finding) => finding.code)).toContain('HOSTNAME_ONLY');
  });

  test('profiles raise the floor and refuse to start below it', () => {
    const mes = { url: 'https://mes.plant', addresses: ['10.20.0.15/32'] };
    expect(
      codes({ profile: 'sandbox', mode: 'connected', destinations: { 'mes-api': mes } }),
    ).toEqual(['IDENTITY_FLOOR', 'GRANT_FLOOR']);
    expect(
      codes({
        profile: 'sandbox',
        mode: 'connected',
        identity: 'grant-file',
        grants: { maxTtlSeconds: 600 },
        audit: { mode: 'best-effort' },
        destinations: { 'mes-api': mes, 'station-screen': { url: 'http://hmi.plant:80' } },
      }),
    ).toEqual(['PROTOCOL_MISMATCH', 'PLAINTEXT_EGRESS', 'AUDIT_NOT_REQUIRED']);
    const zeroTrust = codes({
      profile: 'zero-trust',
      mode: 'connected',
      identity: 'grant-file',
      grants: { maxTtlSeconds: 86400 },
      destinations: { 'mes-api': mes, 'legacy-tcp': { url: 'tcp://10.20.0.20:5900' } },
    });
    expect(zeroTrust).toEqual([
      'UNPINNED_TLS',
      'PLAINTEXT_EGRESS',
      'UNPINNED_TLS',
      'AUDIT_NOT_FORWARDED',
      'IDENTITY_FLOOR',
      'GRANT_FLOOR',
    ]);
    expect(() => assertPolicyUsable(policy({ profile: 'zero-trust', mode: 'isolated' }))).toThrow(
      'IDENTITY_FLOOR',
    );
    const pinned = 'AB:'.repeat(31) + 'AB';
    const external = {
      profile: 'zero-trust',
      mode: 'connected',
      identity: 'external',
      grants: { maxTtlSeconds: 900 },
      audit: { forwardTo: 'station-screen' },
      destinations: {
        'mes-api': { ...mes, certificatePins: [pinned] },
        'station-screen': { url: 'https://collector.plant', certificatePins: [pinned] },
      },
    } as const satisfies SitePolicyInput;
    // External identity names a workforce provider whose issuer is the bound destination's origin.
    expect(codes(external)).toEqual(['IDENTITY_PROVIDER']);
    const workforce = { issuer: 'https://login.corp.example/tenant', clientId: 'site-app' };
    const idp = { url: 'https://login.corp.example', certificatePins: [pinned] };
    expect(codes({ ...external, workforce })).toEqual(['IDENTITY_PROVIDER']);
    expect(
      codes({
        ...external,
        workforce: { ...workforce, issuer: 'https://other.example' },
        destinations: { ...external.destinations, 'workforce-idp': idp },
      }),
    ).toEqual(['IDENTITY_PROVIDER']);
    expect(
      codes({
        ...external,
        workforce,
        destinations: { ...external.destinations, 'workforce-idp': idp },
      }),
    ).toEqual([]);
  });

  test('a site hub serves paired devices over TLS; desktop-local and zero-trust do not', async () => {
    const hub = {
      profile: 'site-hub',
      grants: { maxTtlSeconds: 600 },
      ingress: { listen: 'tls', host: 'hub.site', port: 8443, cert: 'hub.pem', key: 'hub.key' },
    } as SitePolicyInput;
    // The local owner still runs a site hub; its audit and egress floors are the sandbox's.
    expect(codes(hub)).toEqual([]);
    expect(codes({ ...hub, audit: { mode: 'best-effort' } })).toEqual(['AUDIT_NOT_REQUIRED']);
    expect(codes({ ...hub, profile: 'desktop-local' })).toEqual(['INGRESS_FLOOR']);
    expect(
      codes({ ...hub, profile: 'zero-trust', identity: 'external' } as SitePolicyInput),
    ).toContain('INGRESS_FLOOR');
    expect(codes({ ...hub, ingress: { listen: 'tls' } } as SitePolicyInput)).toEqual([
      'INGRESS_FLOOR',
      'INGRESS_FLOOR',
    ]);
    // A client CA on a plain TLS listener would look enforced while nothing checks it.
    expect(
      codes({ ...hub, ingress: { ...hub.ingress, clientCa: 'ca.pem' } } as SitePolicyInput),
    ).toEqual(['INGRESS_FLOOR']);
    const directory = await mkdtemp(join(tmpdir(), 'egress-tls-'));
    try {
      await writeFile(join(directory, 'hub.pem'), 'cert');
      await writeFile(join(directory, 'hub.key'), 'key');
      await writeFile(join(directory, 'policy.json'), JSON.stringify(hub));
      const loaded = await loadSitePolicy(join(directory, 'policy.json'), requirements);
      expect(loaded.findings).toEqual([]);
      expect(loaded.ingressTls).toEqual({
        cert: join(directory, 'hub.pem'),
        key: join(directory, 'hub.key'),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('a non-loopback listener needs mutual TLS with a named host and fixed port', async () => {
    const floor = { profile: 'sandbox', identity: 'grant-file', grants: { maxTtlSeconds: 600 } };
    expect(codes({ ...floor, ingress: { listen: 'mtls' } } as SitePolicyInput)).toEqual([
      'INGRESS_FLOOR',
      'INGRESS_FLOOR',
    ]);
    expect(codes({ ingress: { listen: 'mtls', host: 'a', port: 1 } } as SitePolicyInput)).toEqual([
      'INGRESS_FLOOR',
      'INGRESS_FLOOR',
    ]);
    // Only listeners the host implements are accepted at all.
    expect(() => policy({ ingress: { listen: 'unix' } } as unknown as SitePolicyInput)).toThrow();
    // Listener files are resolved next to the policy and must be readable; contents stay on disk.
    const directory = await mkdtemp(join(tmpdir(), 'egress-ingress-'));
    try {
      await writeFile(join(directory, 'server.pem'), 'cert');
      const path = join(directory, 'policy.json');
      const ingress = { listen: 'mtls', host: 'authority.plant', port: 8443 };
      await writeFile(
        path,
        JSON.stringify({
          ...floor,
          ingress: { ...ingress, cert: 'server.pem', key: 'missing.key', clientCa: 'server.pem' },
        }),
      );
      expect((await loadSitePolicy(path, requirements)).findings.map((f) => f.code)).toEqual([
        'INGRESS_UNREADABLE',
      ]);
      await writeFile(join(directory, 'server.key'), 'key');
      await writeFile(
        path,
        JSON.stringify({
          ...floor,
          ingress: { ...ingress, cert: 'server.pem', key: 'server.key', clientCa: 'server.pem' },
        }),
      );
      const loaded = await loadSitePolicy(path, requirements);
      expect(loaded.findings).toEqual([]);
      expect(loaded.ingressTls).toEqual({
        cert: join(directory, 'server.pem'),
        key: join(directory, 'server.key'),
        clientCa: join(directory, 'server.pem'),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

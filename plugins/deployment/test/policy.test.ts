import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectRequirements, type NetworkDestination } from '@tortoise/contracts';
import { cidrContains, parseCidr } from '../src/cidr';
import { judgeCertificates, type CertificateValidity } from '../src/policy/certificates';
import {
  assertPolicyUsable,
  isolatedPolicy,
  loadDeploymentPolicy,
  resolveDeploymentPolicy,
  type DeploymentPolicyInput,
} from '../src/policy';

const localDestination = (
  id: string,
  extra: Partial<NetworkDestination> = {},
): NetworkDestination => ({
  id,
  purpose: 'test',
  direction: 'outbound',
  scope: 'local',
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
        localDestination('mes-api', {
          availability: 'required',
          targets: ['mes'],
          offline: 'queue',
        }),
        localDestination('station-screen'),
        localDestination('vendor-api', { scope: 'internet', host: 'api.vendor.example' }),
        localDestination('local-model', { scope: 'loopback', protocol: 'http', dataClasses: [] }),
        localDestination('legacy-tcp', { protocol: 'tcp' }),
        localDestination('loopback-tcp', { scope: 'loopback', protocol: 'tcp', dataClasses: [] }),
        localDestination('workforce-idp', { scope: 'internet', dataClasses: ['identity'] }),
        localDestination('quality-peer', { authenticated: true, protocol: 'http' }),
        localDestination('quality-tls', { authenticated: true }),
      ],
      folders: [
        {
          id: 'erp-drop',
          purpose: 'test',
          access: 'write',
          targets: ['erp'],
          dataClasses: ['order'],
          availability: 'optional',
        },
        {
          id: 'erp-results',
          purpose: 'test',
          access: 'read',
          dataClasses: ['order'],
          availability: 'optional',
        },
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
/** A public test certificate valid from 2026-10-17 for a century; its key was never kept. */
const certificate = await readFile(join(import.meta.dir, 'fixtures/test-certificate.pem'), 'utf8');
const policy = (input: DeploymentPolicyInput) => resolveDeploymentPolicy(input, requirements);
const codes = (input: DeploymentPolicyInput) =>
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

describe('deployment policy', () => {
  test('no policy means isolated: everything off-host is a listed consequence, not an error', () => {
    const resolved = isolatedPolicy(requirements);
    expect(resolved.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(resolved.consequences.find((item) => item.destination === 'mes-api')).toMatchObject({
      reason: 'isolated',
      offline: 'queue',
      targets: ['mes'],
    });
  });

  test('a policy that does not match the schema is refused as input, naming each field', () => {
    let refused: unknown;
    try {
      resolveDeploymentPolicy(
        { destinations: { 'vendor-api': { url: 'https://api.vendor.example', retries: 3 } } },
        requirements,
      );
    } catch (error) {
      refused = error;
    }
    expect(refused).toMatchObject({
      code: 'INVALID_INPUT',
      details: [{ path: 'destinations.vendor-api', message: 'Unrecognized key: "retries"' }],
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

  test('a credential is sent in plain text only on loopback, where an https declaration warns', () => {
    const findings = (destinations: DeploymentPolicyInput['destinations']) =>
      policy({
        mode: 'connected',
        destinations: { 'mes-api': { disabled: true }, ...destinations },
      }).findings.map(({ level, code }) => [level, code]);
    // desktop-local allows plain text elsewhere, never with a credential.
    expect(
      findings({ 'quality-peer': { url: 'http://10.0.0.7:4300', addresses: ['10.0.0.7/32'] } }),
    ).toEqual([['error', 'PLAINTEXT_CREDENTIAL']]);
    expect(findings({ 'quality-peer': { url: 'http://127.0.0.1:4300' } })).toEqual([]);
    expect(findings({ 'quality-tls': { url: 'http://127.0.0.1:4300' } })).toEqual([
      ['warning', 'LOOPBACK_PLAINTEXT'],
    ]);
    expect(
      findings({ 'quality-tls': { url: 'http://10.0.0.7:4300', addresses: ['10.0.0.7/32'] } }),
    ).toEqual([
      ['error', 'PROTOCOL_MISMATCH'],
      ['error', 'PLAINTEXT_CREDENTIAL'],
    ]);
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
    ).toEqual(['PROTOCOL_MISMATCH', 'PLAINTEXT_OUTBOUND', 'AUDIT_NOT_REQUIRED']);
    const zeroTrust = codes({
      profile: 'zero-trust',
      mode: 'connected',
      identity: 'grant-file',
      grants: { maxTtlSeconds: 86400 },
      destinations: { 'mes-api': mes, 'legacy-tcp': { url: 'tcp://10.20.0.20:5900' } },
    });
    expect(zeroTrust).toEqual([
      'UNPINNED_TLS',
      'PLAINTEXT_OUTBOUND',
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
    } as const satisfies DeploymentPolicyInput;
    // External identity names a workforce provider whose issuer is the bound destination's origin.
    expect(codes(external)).toEqual(['IDENTITY_PROVIDER']);
    const workforce = { issuer: 'https://login.corp.example/tenant', clientId: 'workforce-app' };
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

  test('a hub serves paired devices over TLS; desktop-local and zero-trust do not', async () => {
    const hub = {
      profile: 'hub',
      grants: { maxTtlSeconds: 600 },
      ingress: { listen: 'tls', host: 'hub.plant', port: 8443, cert: 'hub.pem', key: 'hub.key' },
    } as DeploymentPolicyInput;
    // The local user still runs a hub; its audit and network floors are the sandbox's.
    expect(codes(hub)).toEqual([]);
    expect(codes({ ...hub, audit: { mode: 'best-effort' } })).toEqual(['AUDIT_NOT_REQUIRED']);
    expect(codes({ ...hub, profile: 'desktop-local' })).toEqual(['INGRESS_FLOOR']);
    expect(
      codes({ ...hub, profile: 'zero-trust', identity: 'external' } as DeploymentPolicyInput),
    ).toContain('INGRESS_FLOOR');
    expect(codes({ ...hub, ingress: { listen: 'tls' } } as DeploymentPolicyInput)).toEqual([
      'INGRESS_FLOOR',
      'INGRESS_FLOOR',
    ]);
    // A client CA on a plain TLS listener would look enforced while nothing checks it.
    expect(
      codes({ ...hub, ingress: { ...hub.ingress, clientCa: 'ca.pem' } } as DeploymentPolicyInput),
    ).toEqual(['INGRESS_FLOOR']);
    const directory = await mkdtemp(join(tmpdir(), 'network-tls-'));
    try {
      await writeFile(join(directory, 'hub.pem'), certificate);
      await writeFile(join(directory, 'hub.key'), 'key');
      await writeFile(join(directory, 'policy.json'), JSON.stringify(hub));
      const loaded = await loadDeploymentPolicy(join(directory, 'policy.json'), requirements);
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
    expect(codes({ ...floor, ingress: { listen: 'mtls' } } as DeploymentPolicyInput)).toEqual([
      'INGRESS_FLOOR',
      'INGRESS_FLOOR',
    ]);
    expect(
      codes({ ingress: { listen: 'mtls', host: 'a', port: 1 } } as DeploymentPolicyInput),
    ).toEqual(['INGRESS_FLOOR', 'INGRESS_FLOOR']);
    // Only listeners the host implements are accepted at all.
    expect(() =>
      policy({ ingress: { listen: 'unix' } } as unknown as DeploymentPolicyInput),
    ).toThrow();
    // Listener files are resolved next to the policy and must be readable; contents stay on disk.
    const directory = await mkdtemp(join(tmpdir(), 'network-ingress-'));
    try {
      await writeFile(join(directory, 'server.pem'), certificate);
      const path = join(directory, 'policy.json');
      const ingress = { listen: 'mtls', host: 'instance.plant', port: 8443 };
      await writeFile(
        path,
        JSON.stringify({
          ...floor,
          ingress: { ...ingress, cert: 'server.pem', key: 'missing.key', clientCa: 'server.pem' },
        }),
      );
      expect((await loadDeploymentPolicy(path, requirements)).findings.map((f) => f.code)).toEqual([
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
      const loaded = await loadDeploymentPolicy(path, requirements);
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

describe('certificates', () => {
  const day = 86_400_000;
  const hub = {
    profile: 'hub',
    grants: { maxTtlSeconds: 600 },
    ingress: { listen: 'tls', host: 'hub.plant', port: 8443, cert: 'hub.pem', key: 'hub.key' },
  } as DeploymentPolicyInput;
  async function loadAt(files: Record<string, string>, input: DeploymentPolicyInput, now?: number) {
    const directory = await mkdtemp(join(tmpdir(), 'certificates-'));
    try {
      for (const [name, text] of Object.entries(files))
        await writeFile(join(directory, name), text);
      await writeFile(join(directory, 'policy.json'), JSON.stringify(input));
      return await loadDeploymentPolicy(join(directory, 'policy.json'), requirements, {
        ...(now !== undefined ? { now } : {}),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  const findings = (resolved: Awaited<ReturnType<typeof loadAt>>) =>
    resolved.findings.map((finding) => `${finding.level}:${finding.code}`);

  test('the listener certificate is read without its key and judged at load', async () => {
    const files = { 'hub.pem': certificate, 'hub.key': 'never read' };
    const valid = await loadAt(files, hub);
    expect(valid.findings).toEqual([]);
    expect(valid.certificates).toHaveLength(1);
    const [leaf] = valid.certificates;
    expect(leaf).toMatchObject({ source: 'ingress-cert', subject: 'CN=network-test' });
    expect(JSON.stringify(valid.certificates)).not.toContain('never read');

    expect(findings(await loadAt(files, hub, leaf!.notAfter - 10 * day))).toEqual([
      'warning:CERTIFICATE_EXPIRING',
    ]);
    const expired = await loadAt(files, hub, leaf!.notAfter + 1);
    expect(findings(expired)).toEqual(['error:CERTIFICATE_EXPIRED']);
    expect(() => assertPolicyUsable(expired)).toThrow('CERTIFICATE_EXPIRED');
    expect(findings(await loadAt(files, hub, leaf!.notBefore - day))).toEqual([
      'error:CERTIFICATE_NOT_YET_VALID',
    ]);
    expect(findings(await loadAt({ ...files, 'hub.pem': 'not a certificate' }, hub))).toEqual([
      'error:CERTIFICATE_INVALID',
    ]);
  });

  test('a destination CA bundle is judged for its destination', async () => {
    const connected = {
      mode: 'connected',
      destinations: {
        'mes-api': { url: 'https://mes.plant.local:8443', ca: 'mes-ca.pem' },
        'station-screen': { disabled: true },
      },
    } as DeploymentPolicyInput;
    const loaded = await loadAt({ 'mes-ca.pem': certificate }, connected);
    expect(loaded.certificates.map((item) => [item.source, item.destination])).toEqual([
      ['destination-ca', 'mes-api'],
    ]);
    const expired = await loadAt(
      { 'mes-ca.pem': certificate },
      connected,
      loaded.certificates[0]!.notAfter + 1,
    );
    expect(expired.findings.filter((finding) => finding.code.startsWith('CERTIFICATE'))).toEqual([
      expect.objectContaining({
        level: 'error',
        code: 'CERTIFICATE_EXPIRED',
        destination: 'mes-api',
      }),
    ]);
  });

  test('a bundle fails only when none of its certificates is valid', () => {
    const at = Date.UTC(2030, 0, 1);
    const ca = (subject: string, notBefore: number, notAfter: number): CertificateValidity => ({
      source: 'ingress-client-ca',
      subject,
      fingerprint256: subject,
      notBefore,
      notAfter,
    });
    const old = ca('CN=old', at - 400 * day, at - day);
    const next = ca('CN=next', at - day, at + 400 * day);
    expect(judgeCertificates([old, next], at).map((item) => [item.level, item.code])).toEqual([
      ['warning', 'CERTIFICATE_EXPIRED'],
    ]);
    expect(judgeCertificates([next], at)).toEqual([]);
    expect(judgeCertificates([old], at).map((item) => [item.level, item.code])).toEqual([
      ['error', 'CERTIFICATE_EXPIRED'],
    ]);
    // Only the leaf of a listener's chain decides; an intermediate in the file is not judged.
    expect(
      judgeCertificates(
        [next, old].map((item) => ({ ...item, source: 'ingress-cert' as const })),
        at,
      ),
    ).toEqual([]);
  });
});

describe('folders', () => {
  test('a required folder must be bound, to an absolute path no other folder shares', () => {
    const required = collectRequirements([
      {
        id: 'app',
        requirements: {
          folders: [
            {
              id: 'drop',
              purpose: 'test',
              access: 'write',
              dataClasses: ['order'],
              availability: 'required',
            },
          ],
        },
      },
    ]);
    const errors = (input: DeploymentPolicyInput) =>
      resolveDeploymentPolicy(input, required).findings.map((finding) => finding.code);
    expect(errors({})).toEqual(['REQUIRED_FOLDER_UNBOUND']);
    expect(errors({ folders: { drop: { disabled: true } } })).toEqual([]);
    expect(codes({ folders: { 'erp-drop': { path: 'relative/drop' } } })).toContain('FOLDER_PATH');
    expect(
      codes({
        folders: { 'erp-drop': { path: '/srv/erp/' }, 'erp-results': { path: '/srv/erp' } },
      }),
    ).toContain('FOLDER_SHARED');
    expect(codes({ folders: { unknown: { path: '/srv/x' } } })).toContain('UNDECLARED_FOLDER');
    expect(codes({ folders: { 'erp-drop': { path: 'C:\\exchange\\drop' } } })).toEqual([]);
  });

  test('a bound folder whose directory is missing is a warning, so a later mount still works', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'folders-'));
    try {
      const file = join(directory, 'deployment-policy.json');
      await writeFile(
        file,
        JSON.stringify({
          folders: {
            'erp-drop': { path: directory },
            'erp-results': { path: join(directory, 'gone') },
          },
        }),
      );
      const resolved = await loadDeploymentPolicy(file, requirements);
      expect(resolved.folders.get('erp-drop')?.path).toBe(directory);
      expect(resolved.findings.filter((finding) => finding.code === 'FOLDER_MISSING')).toEqual([
        {
          level: 'warning',
          code: 'FOLDER_MISSING',
          message: 'Folder erp-results is bound to a directory that does not exist',
          destination: 'erp-results',
        },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { connect, createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectRequirements,
  type AuditRecord,
  type EventLogPort,
  type NetworkDestination,
} from '@agent-native/contracts';
import { createMemoryEventLog } from '@agent-native/event-log';
import {
  assertPolicyUsable,
  cidrContains,
  createEgress,
  EgressDenied,
  isolatedPolicy,
  loadSitePolicy,
  parseCidr,
  resolveSitePolicy,
  startEgressProxy,
  type SitePolicyInput,
} from '../src/index';

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
    expect(
      codes({
        profile: 'zero-trust',
        mode: 'connected',
        identity: 'external',
        grants: { maxTtlSeconds: 900 },
        audit: { forwardTo: 'station-screen' },
        destinations: {
          'mes-api': { ...mes, certificatePins: [pinned] },
          'station-screen': { url: 'https://collector.plant', certificatePins: [pinned] },
        },
      }),
    ).toEqual([]);
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

/** A loopback HTTP server standing in for a bound destination. */
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/hop') return Response.redirect(`${url.origin}/ok`, 302);
    if (url.pathname === '/away') return Response.redirect('http://127.0.0.2:9/', 302);
    if (url.pathname === '/big') return new Response('x'.repeat(4096));
    return new Response('ok');
  },
});
afterAll(() => server.stop(true));
const local = (eventLog?: EventLogPort) =>
  createEgress({
    policy: policy({
      mode: 'isolated',
      destinations: { 'local-model': { url: `http://127.0.0.1:${server.port}` } },
    }),
    requirements,
    ...(eventLog ? { eventLog } : {}),
    maxResponseBytes: 1024,
  });

describe('egress guard', () => {
  test('a bound destination is reachable at its origin and every hop is audited', async () => {
    const log = createMemoryEventLog();
    const response = await local(log).client('local-model').fetch('/hop');
    expect(await response.text()).toBe('ok');
    expect(log.events().map((event) => event.kind)).toEqual([
      'egress.allowed',
      'egress.completed',
      'egress.allowed',
      'egress.completed',
    ]);
    expect(JSON.stringify(log.events())).not.toContain('"body"');
  });

  test('undeclared, unbound, disabled and off-origin requests are refused and recorded', async () => {
    const log = createMemoryEventLog();
    const egress = local(log);
    const reason = (promise: Promise<unknown>) =>
      promise.then(
        () => 'allowed',
        (error: unknown) => (error instanceof EgressDenied ? error.reason : String(error)),
      );
    expect(await reason(egress.client('somewhere').fetch('/'))).toBe('UNDECLARED');
    expect(await reason(egress.client('mes-api').fetch('/'))).toBe('UNBOUND');
    expect(await reason(egress.client('local-model').fetch('http://127.0.0.1:1/'))).toBe(
      'ORIGIN_MISMATCH',
    );
    expect(await reason(egress.client('local-model').fetch('/away'))).toBe('REDIRECT_NOT_ALLOWED');
    expect(log.events().filter((event) => event.kind === 'egress.denied')).toHaveLength(4);
  });

  test('a routed fetch picks the bound destination by origin and explains refusals', async () => {
    const log = createMemoryEventLog();
    const routed = local(log).routedFetch(['local-model', 'vendor-api']);
    const response = await routed(
      new Request(`http://127.0.0.1:${server.port}/ok`, { method: 'POST', body: 'x' }),
    );
    expect(await response.text()).toBe('ok');
    expect(log.events()[0]).toMatchObject({
      kind: 'egress.allowed',
      data: { destination: 'local-model', method: 'POST' },
    });
    const refusal = (url: string) =>
      routed(url).then(
        () => undefined,
        (error: unknown) => error,
      );
    // A fixed vendor host that is declared but unbound reports UNBOUND, not a generic mismatch.
    expect(await refusal('https://api.vendor.example/v1')).toMatchObject({
      code: 'UNAVAILABLE',
      reason: 'UNBOUND',
      destination: 'vendor-api',
    });
    expect(await refusal('https://elsewhere.example/')).toMatchObject({
      reason: 'ORIGIN_MISMATCH',
    });
  });

  test('responses larger than the cap error instead of filling memory', async () => {
    const response = await local().client('local-model').fetch('/big');
    await expect(response.text()).rejects.toThrow('RESPONSE_TOO_LARGE');
  });

  test('a required egress log that cannot be written keeps the connection closed', async () => {
    let fetched = false;
    const broken: EventLogPort = {
      mode: { commands: 'required', queries: 'required', egress: 'required' },
      append: () => Promise.reject(new Error('disk full')),
    };
    const egress = createEgress({
      policy: policy({
        mode: 'isolated',
        destinations: { 'local-model': { url: `http://127.0.0.1:${server.port}` } },
      }),
      requirements,
      eventLog: broken,
      fetch: (async () => {
        fetched = true;
        return new Response('');
      }) as unknown as typeof fetch,
    });
    await expect(egress.client('local-model').fetch('/')).rejects.toMatchObject({
      reason: 'AUDIT_UNAVAILABLE',
    });
    expect(fetched).toBe(false);
  });

  test('DNS answers outside the bound networks are refused before connecting', async () => {
    const calls: string[] = [];
    const egress = createEgress({
      policy: policy({
        mode: 'connected',
        destinations: {
          'mes-api': { url: 'https://mes.plant', addresses: ['10.20.0.0/24'] },
          'local-model': { url: 'http://localhost:11434' },
        },
      }),
      requirements,
      lookup: async (host) => (host === 'mes.plant' ? ['10.20.0.9', '203.0.113.7'] : ['10.0.0.1']),
      fetch: (async (url: URL) => {
        calls.push(String(url));
        return new Response('');
      }) as unknown as typeof fetch,
    });
    await expect(egress.client('mes-api').fetch('/orders')).rejects.toMatchObject({
      reason: 'ADDRESS_NOT_ALLOWED',
    });
    // A loopback destination whose name resolves off-host is refused too.
    await expect(egress.client('local-model').fetch('/')).rejects.toMatchObject({
      reason: 'ADDRESS_NOT_ALLOWED',
    });
    expect(calls).toEqual([]);
  });
});

describe('child process proxy', () => {
  test('a declared process tunnels only to its declared destinations', async () => {
    const echo = createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', resolve));
    const port = (echo.address() as AddressInfo).port;
    const log = createMemoryEventLog();
    const egress = createEgress({
      policy: policy({
        mode: 'isolated',
        destinations: { 'loopback-tcp': { url: `tcp://127.0.0.1:${port}` } },
      }),
      requirements,
      eventLog: log,
    });
    const proxy = await startEgressProxy(egress);
    const environment = proxy.childEnvironment('agent-cli');
    const credential = new URL(environment.HTTPS_PROXY!);
    const authorization = Buffer.from(
      `${decodeURIComponent(credential.username)}:${credential.password}`,
    ).toString('base64');
    const exchange = (target: string, auth?: string) =>
      new Promise<string>((resolve) => {
        const socket = connect(Number(proxy.url.port), '127.0.0.1');
        let text = '';
        socket.on('data', (chunk) => {
          text += chunk.toString();
          if (text.startsWith('HTTP/1.1 200') && !text.includes('ping')) socket.write('ping');
          if (text.includes('ping') || !text.startsWith('HTTP/1.1 200')) {
            socket.destroy();
            resolve(text);
          }
        });
        socket.write(
          `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth ? `Proxy-Authorization: Basic ${auth}\r\n` : ''}\r\n`,
        );
      });
    try {
      expect(await exchange(`127.0.0.1:${port}`, authorization)).toContain('ping');
      expect(await exchange(`127.0.0.1:${port}`)).toStartWith('HTTP/1.1 407');
      expect(await exchange('127.0.0.1:1', authorization)).toStartWith('HTTP/1.1 403');
      expect(() => proxy.childEnvironment('undeclared')).toThrow('PROCESS_NOT_DECLARED');
      const kinds = log.events().map((event: AuditRecord) => [event.kind, event.reason]);
      expect(kinds).toContainEqual(['egress.allowed', undefined]);
      expect(kinds).toContainEqual(['egress.denied', 'PROCESS_NOT_PERMITTED']);
    } finally {
      await proxy.close();
      echo.close();
    }
  });
});

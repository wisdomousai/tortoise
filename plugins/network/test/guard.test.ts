import { afterAll, describe, expect, test } from 'bun:test';
import { connect, createServer, type AddressInfo } from 'node:net';
import {
  collectRequirements,
  type AuditRecord,
  type EventLogPort,
  type NetworkDestination,
} from '@tortoise/contracts';
import { createMemoryEventLog } from '@tortoise/event-log';
import { resolveDeploymentPolicy, type DeploymentPolicyInput } from '@tortoise/deployment/policy';
import { createNetworkGuard, NetworkDenied } from '../src/guard';
import { startNetworkProxy } from '../src/proxy';

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
const policy = (input: DeploymentPolicyInput) => resolveDeploymentPolicy(input, requirements);
const codes = (input: DeploymentPolicyInput) =>
  policy(input)
    .findings.filter((finding) => finding.level === 'error')
    .map((finding) => finding.code);

/** A loopback HTTP server standing in for a bound destination. */
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/hop') return Response.redirect(`${url.origin}/ok`, 302);
    if (url.pathname === '/away') return Response.redirect('http://127.0.0.2:9/', 302);
    if (url.pathname === '/big') return new Response('x'.repeat(4096));
    if (url.pathname === '/slow') return Bun.sleep(1_500).then(() => new Response('late'));
    return new Response('ok');
  },
});
afterAll(() => server.stop(true));
const local = (eventLog?: EventLogPort) =>
  createNetworkGuard({
    policy: policy({
      mode: 'isolated',
      destinations: { 'local-model': { url: `http://127.0.0.1:${server.port}` } },
    }),
    requirements,
    ...(eventLog ? { eventLog } : {}),
    maxResponseBytes: 1024,
  });

describe('guard guard', () => {
  test("a binding's timeout replaces the guard's default for that destination only", async () => {
    const guard = (timeoutMs?: number) =>
      createNetworkGuard({
        policy: policy({
          mode: 'isolated',
          destinations: {
            'local-model': {
              url: `http://127.0.0.1:${server.port}`,
              ...(timeoutMs ? { timeoutMs } : {}),
            },
          },
        }),
        requirements,
        timeoutMs: 1_000,
      });
    await expect(guard().client('local-model').fetch('/slow')).rejects.toThrow();
    const response = await guard(5_000).client('local-model').fetch('/slow');
    expect(await response.text()).toBe('late');
    expect(() =>
      policy({ destinations: { 'local-model': { url: 'http://127.0.0.1:1', timeoutMs: 10 } } }),
    ).toThrow('expected number to be >=1000');
  });

  test('a bound destination is reachable at its origin and every hop is audited', async () => {
    const log = createMemoryEventLog();
    const response = await local(log).client('local-model').fetch('/hop');
    expect(await response.text()).toBe('ok');
    expect(log.events().map((event) => event.kind)).toEqual([
      'network.allowed',
      'network.completed',
      'network.allowed',
      'network.completed',
    ]);
    expect(JSON.stringify(log.events())).not.toContain('"body"');
  });

  test('undeclared, unbound, disabled and off-origin requests are refused and recorded', async () => {
    const log = createMemoryEventLog();
    const guard = local(log);
    const reason = (promise: Promise<unknown>) =>
      promise.then(
        () => 'allowed',
        (error: unknown) => (error instanceof NetworkDenied ? error.reason : String(error)),
      );
    expect(await reason(guard.client('somewhere').fetch('/'))).toBe('UNDECLARED');
    expect(await reason(guard.client('mes-api').fetch('/'))).toBe('UNBOUND');
    expect(await reason(guard.client('local-model').fetch('http://127.0.0.1:1/'))).toBe(
      'ORIGIN_MISMATCH',
    );
    expect(await reason(guard.client('local-model').fetch('/away'))).toBe('REDIRECT_NOT_ALLOWED');
    expect(log.events().filter((event) => event.kind === 'network.denied')).toHaveLength(4);
  });

  test('a routed fetch picks the bound destination by origin and explains refusals', async () => {
    const log = createMemoryEventLog();
    const routed = local(log).routedFetch(['local-model', 'vendor-api']);
    const response = await routed(
      new Request(`http://127.0.0.1:${server.port}/ok`, { method: 'POST', body: 'x' }),
    );
    expect(await response.text()).toBe('ok');
    expect(log.events()[0]).toMatchObject({
      kind: 'network.allowed',
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

  test("a binding's response cap replaces the guard's default for that destination only", async () => {
    const guard = createNetworkGuard({
      policy: policy({
        mode: 'isolated',
        destinations: {
          'local-model': { url: `http://127.0.0.1:${server.port}`, maxResponseBytes: 1_048_576 },
        },
      }),
      requirements,
      maxResponseBytes: 1024,
    });
    expect(await (await guard.client('local-model').fetch('/big')).text()).toHaveLength(4096);
    expect(() =>
      policy({
        destinations: { 'local-model': { url: 'http://127.0.0.1:1', maxResponseBytes: 1024 } },
      }),
    ).toThrow('expected number to be >=1048576');
  });

  test('a required guard log that cannot be written keeps the connection closed', async () => {
    let fetched = false;
    const broken: EventLogPort = {
      mode: { commands: 'required', queries: 'required', network: 'required' },
      append: () => Promise.reject(new Error('disk full')),
    };
    const guard = createNetworkGuard({
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
    await expect(guard.client('local-model').fetch('/')).rejects.toMatchObject({
      reason: 'AUDIT_UNAVAILABLE',
    });
    expect(fetched).toBe(false);
  });

  test('resolved addresses outside the bound networks are refused before connecting', async () => {
    const calls: string[] = [];
    const guard = createNetworkGuard({
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
    await expect(guard.client('mes-api').fetch('/orders')).rejects.toMatchObject({
      reason: 'ADDRESS_NOT_ALLOWED',
    });
    // A loopback destination whose name resolves off-host is refused too.
    await expect(guard.client('local-model').fetch('/')).rejects.toMatchObject({
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
    const guard = createNetworkGuard({
      policy: policy({
        mode: 'isolated',
        destinations: { 'loopback-tcp': { url: `tcp://127.0.0.1:${port}` } },
      }),
      requirements,
      eventLog: log,
    });
    const proxy = await startNetworkProxy(guard);
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
      expect(kinds).toContainEqual(['network.allowed', undefined]);
      expect(kinds).toContainEqual(['network.denied', 'PROCESS_NOT_PERMITTED']);
    } finally {
      await proxy.close();
      echo.close();
    }
  });
});

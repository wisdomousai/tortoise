import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sessionCookieName } from '@tortoise/adapters/http';
import type { SitePolicyInput } from '@tortoise/site/policy';
import { startHost } from '@tortoise/host/host';
import { writeApplicationEntry } from '../../../../scripts/application-entry';
import fieldService from '../application';

// Hardening floors as the host enforces them, not only as `site check` reports them.

const withDirectory = async (run: (directory: string) => Promise<void>) => {
  const directory = await mkdtemp(join(tmpdir(), 'hardening-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
async function writePolicy(directory: string, policy: SitePolicyInput) {
  const path = join(directory, 'site-policy.json');
  await writeFile(path, JSON.stringify(policy));
  return path;
}
const sandbox: SitePolicyInput = {
  profile: 'sandbox',
  mode: 'isolated',
  identity: 'grant-file',
  grants: { maxTtlSeconds: 3600 },
};
const delegated = (expiresAt?: number) => ({
  workspaceId: 'local',
  principalId: 'line-agent',
  grant: { operations: ['work-order.list'], ...(expiresAt ? { expiresAt } : {}) },
});

test('sandbox admits only the launcher grant, never the local user', async () => {
  await withDirectory(async (directory) => {
    const sitePolicy = await writePolicy(directory, sandbox);
    const workspacePath = join(directory, 'workspace');
    const base = {
      workspacePath,
      integration: false as const,
      settings: { 'site-policy': sitePolicy },
    };
    await expect(startHost(fieldService, base)).rejects.toThrow(/admits only delegated grants/);
    const agentPath = join(directory, 'agent.json');
    // A grant without an expiry, or longer than the policy allows, is refused before startup.
    await expect(
      startHost(fieldService, {
        ...base,
        agentConnection: { context: delegated(), path: agentPath },
      }),
    ).rejects.toThrow(/must expire within 3600 seconds/);
    await expect(
      startHost(fieldService, {
        ...base,
        agentConnection: { context: delegated(Date.now() + 2 * 3600_000), path: agentPath },
      }),
    ).rejects.toThrow(/must expire within 3600 seconds/);

    const host = await startHost(fieldService, {
      ...base,
      agentConnection: { context: delegated(Date.now() + 1800_000), path: agentPath },
    });
    try {
      // No local-user credential exists on disk; the delegate's connection file is the only one.
      expect(host.connectionFile).toBeUndefined();
      expect(existsSync(join(host.workspacePath, '.connection.json'))).toBe(false);
      const { token } = (await Bun.file(agentPath).json()) as { token: string };
      const list = await fetch(`${host.url}/api/v1/queries/work-order.list`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ input: {} }),
      });
      expect(list.status).toBe(200);
      const other = await fetch(`${host.url}/api/v1/queries/task.list`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ input: {} }),
      });
      expect(other.status).toBe(403);
    } finally {
      await host.close();
    }
  });
});

test('an external identity floor needs a workforce provider, then admits only signed-in people', async () => {
  await withDirectory(async (directory) => {
    const start = async (policy: SitePolicyInput) =>
      startHost(fieldService, {
        workspacePath: join(directory, 'workspace'),
        integration: false,
        settings: { 'site-policy': await writePolicy(directory, policy) },
      });
    await expect(start({ ...sandbox, identity: 'external' })).rejects.toThrow(
      /IDENTITY_PROVIDER: external identity requires a workforce identity provider/,
    );
    const host = await start({
      ...sandbox,
      mode: 'connected',
      identity: 'external',
      workforce: { issuer: 'https://login.corp.example/tenant', clientId: 'field-service' },
      destinations: { 'workforce-idp': { url: 'https://login.corp.example' } },
    });
    try {
      // No local-user session or launch link exists; a cookie the sign-in did not set opens nothing.
      expect(host.connectionFile).toBeUndefined();
      expect(host.launchUrl).toBeUndefined();
      const list = (cookie?: string) =>
        fetch(`${host.url}/api/v1/queries/work-order.list`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: host.url,
            ...(cookie ? { cookie: `${sessionCookieName(host.url)}=${cookie}` } : {}),
          },
          body: JSON.stringify({ input: {} }),
        });
      expect((await list()).status).toBe(403);
      expect((await list('forged')).status).toBe(403);
      // Sign-out is a sign-in route of its own and checks the origin itself.
      const signOut = await fetch(`${host.url}/auth/sign-out`, { method: 'POST' });
      expect(signOut.status).toBe(403);
    } finally {
      await host.close();
    }
  });
});

test('embedded CLI calls under a grant-file policy refuse the local user', async () => {
  await withDirectory(async (directory) => {
    const sitePolicy = await writePolicy(directory, sandbox);
    const entry = await writeApplicationEntry('cli', directory, resolve(import.meta.dir, '..'));
    const child = Bun.spawn(
      [
        process.execPath,
        entry,
        'work-order.list',
        '--embedded',
        '--workspace',
        join(directory, 'workspace'),
        '--site-policy',
        sitePolicy,
        '--audit-log',
        join(directory, 'audit'),
      ],
      { env: { PATH: process.env.PATH }, stdout: 'pipe', stderr: 'pipe' },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode).toBe(4);
    expect(stdout + stderr).toContain('admits only delegated grants');
  });
});

/** Throwaway PKI for one test run: a site CA, server and client certificates, and a rogue CA. */
async function issueCertificates(directory: string) {
  const openssl = async (...args: string[]) => {
    const child = Bun.spawn(['openssl', ...args], {
      cwd: directory,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if ((await child.exited) !== 0)
      throw new Error(`openssl ${args[0]}: ${await new Response(child.stderr).text()}`);
  };
  const instance = async (name: string) =>
    openssl(
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-keyout',
      `${name}.key`,
      '-out',
      `${name}.pem`,
      '-subj',
      `/CN=${name}`,
    );
  const leaf = async (name: string, ca: string, extensions: string) => {
    await writeFile(join(directory, `${name}.ext`), extensions);
    await openssl(
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      `${name}.key`,
      '-out',
      `${name}.csr`,
      '-subj',
      `/CN=${name}`,
    );
    await openssl(
      'x509',
      '-req',
      '-in',
      `${name}.csr`,
      '-CA',
      `${ca}.pem`,
      '-CAkey',
      `${ca}.key`,
      '-CAcreateserial',
      '-days',
      '1',
      '-out',
      `${name}.pem`,
      '-extfile',
      `${name}.ext`,
    );
  };
  await instance('site-ca');
  await instance('rogue-ca');
  await leaf('server', 'site-ca', 'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n');
  await leaf('client', 'site-ca', 'extendedKeyUsage=clientAuth\n');
  await leaf('intruder', 'rogue-ca', 'extendedKeyUsage=clientAuth\n');
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test.skipIf(!Bun.which('openssl'))(
  'an mTLS listener admits only clients with a site certificate, and still needs a session',
  async () => {
    await withDirectory(async (directory) => {
      await issueCertificates(directory);
      const port = await freePort();
      const sitePolicy = await writePolicy(directory, {
        ...sandbox,
        ingress: {
          listen: 'mtls',
          host: 'localhost',
          port,
          cert: 'server.pem',
          key: 'server.key',
          clientCa: 'site-ca.pem',
        },
      });
      const agentPath = join(directory, 'agent.json');
      const host = await startHost(fieldService, {
        workspacePath: join(directory, 'workspace'),
        integration: false,
        settings: { 'site-policy': sitePolicy },
        agentConnection: { context: delegated(Date.now() + 1800_000), path: agentPath },
      });
      try {
        expect(host.url).toBe(`https://localhost:${port}`);
        const file = (name: string) => Bun.file(join(directory, name));
        const trustServer = { ca: file('site-ca.pem') };
        const as = (name: string) => ({
          ...trustServer,
          cert: file(`${name}.pem`),
          key: file(`${name}.key`),
        });
        const health = (tls: object) =>
          fetch(`${host.url}/health`, { tls, keepalive: false } as RequestInit);

        // No client certificate, or one from another CA: the TLS handshake fails.
        await expect(health(trustServer)).rejects.toThrow();
        await expect(health(as('intruder'))).rejects.toThrow();
        expect((await health(as('client'))).status).toBe(200);

        // The certificate authenticates the connection, not the principal.
        const anonymous = await fetch(`${host.url}/api/v1/queries/work-order.list`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: {} }),
          tls: as('client'),
        } as RequestInit);
        expect(anonymous.status).toBe(403);
        const { token } = (await Bun.file(agentPath).json()) as { token: string };
        const listed = await fetch(`${host.url}/api/v1/queries/work-order.list`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ input: {} }),
          tls: as('client'),
        } as RequestInit);
        expect(listed.status).toBe(200);
      } finally {
        await host.close();
      }
    });
  },
);

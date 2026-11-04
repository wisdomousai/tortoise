import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceOwnedError } from '@tortoise/adapters/exclusive-lock';
import { sessionCookieName } from '@tortoise/adapters/http';
import { startHost } from '@tortoise/host/host';
import { hostedPlatform } from '@tortoise/host/platform/hosted';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from '@tortoise/kernel/instance';
import { startIdentityProvider } from '@tortoise/deployment/testing';
import { pgliteDriver } from '@tortoise/testing/postgres';
import { createTestRequestsHostedApplication } from '../application';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const directory = async () => {
  const path = await mkdtemp(join(tmpdir(), 'lab-hosted-'));
  cleanups.push(() => rm(path, { recursive: true, force: true }));
  return path;
};

/**
 * One PGlite database stands in for the shared Postgres server. Each instance has its own driver
 * and local directory, as on two machines.
 */
function sharedDatabase() {
  const { database } = pgliteDriver();
  cleanups.push(() => database.close());
  return () =>
    hostedPlatform({ database: pgliteDriver(database), workspace: 'test-requests', leaseMs: 300 });
}

const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };
const submit = (host: Awaited<ReturnType<typeof startHost>>, sample: string) =>
  host.application.invokeRaw(
    {
      operation: 'test-request.submit',
      input: { sample, transformer: 'TR-40517', description: 'Gas alarm after a load increase' },
      idempotencyKey: crypto.randomUUID(),
    },
    owner,
  );
const samples = async (host: Awaited<ReturnType<typeof startHost>>) =>
  (
    (await host.application.queryRaw({ operation: 'test-request.list', input: {} }, owner))
      .data as { items: { sample: string }[] }
  ).items.map((item) => item.sample);

test('two instances race for the workspace; the second serves the same requests after the first', async () => {
  const root = await directory();
  const platform = sharedDatabase();
  const start = (name: string) =>
    startHost(createTestRequestsHostedApplication(), {
      workspacePath: join(root, name),
      integration: false,
      platform: platform(),
    });
  const [a, b] = await Promise.allSettled([start('a'), start('b')]);
  const serving = [a, b].filter((result) => result.status === 'fulfilled');
  expect(serving).toHaveLength(1);
  const refused = [a, b].find((result) => result.status === 'rejected') as PromiseRejectedResult;
  expect(refused.reason).toBeInstanceOf(WorkspaceOwnedError);
  const first = (serving[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof start>>>).value;
  await submit(first, 'OS-24-0417');

  // The lease outlives its first expiry while the holder renews it.
  await Bun.sleep(400);
  await expect(start('c')).rejects.toBeInstanceOf(WorkspaceOwnedError);

  await first.close();
  const second = await start('c');
  cleanups.push(() => second.close());
  expect(await samples(second)).toEqual(['OS-24-0417']);
  await submit(second, 'OS-24-0418');
  expect((await samples(second)).sort()).toEqual(['OS-24-0417', 'OS-24-0418']);
});

/** A throwaway CA and a certificate for 127.0.0.1 signed by it, written into `path`. */
async function issueCertificate(path: string) {
  const openssl = async (...args: string[]) => {
    const child = Bun.spawn(['openssl', ...args], { cwd: path, stdout: 'pipe', stderr: 'pipe' });
    if ((await child.exited) !== 0)
      throw new Error(`openssl ${args[0]}: ${await new Response(child.stderr).text()}`);
  };
  const days = ['-days', '1'];
  await openssl(
    ...['req', '-x509', '-newkey', 'rsa:2048', '-nodes', ...days],
    ...['-keyout', 'ca.key', '-out', 'ca.pem', '-subj', '/CN=lab-idp-ca'],
  );
  await writeFile(
    join(path, 'idp.ext'),
    'subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n',
  );
  await openssl(
    ...['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'idp.key'],
    ...['-out', 'idp.csr', '-subj', '/CN=127.0.0.1'],
  );
  await openssl(
    ...['x509', '-req', '-in', 'idp.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key'],
    ...['-CAcreateserial', ...days, '-out', 'idp.pem', '-extfile', 'idp.ext'],
  );
  const read = (name: string) => readFile(join(path, name), 'utf8');
  return { ca: await read('ca.pem'), cert: await read('idp.pem'), key: await read('idp.key') };
}

test.skipIf(!Bun.which('openssl'))(
  'staff sign in through the identity provider over HTTPS, and their role decides what they may do',
  async () => {
    const root = await directory();
    const tls = await issueCertificate(root);
    const provider = await startIdentityProvider({
      clientId: 'test-requests',
      people: [{ email: 'ana@lab.example' }, { email: 'ben@lab.example' }],
      tls,
    });
    cleanups.push(async () => provider.stop());
    const policy = join(root, 'deployment-policy.json');
    await writeFile(
      policy,
      JSON.stringify({
        profile: 'desktop-local',
        mode: 'connected',
        audit: { mode: 'best-effort' },
        identity: 'external',
        workforce: { issuer: provider.issuer, clientId: 'test-requests' },
        destinations: { 'workforce-idp': { url: provider.issuer, ca: 'ca.pem' } },
      }),
    );
    const host = await startHost(createTestRequestsHostedApplication(), {
      workspacePath: join(root, 'instance'),
      integration: false,
      platform: sharedDatabase()(),
      settings: { 'deployment-policy': policy },
    });
    cleanups.push(() => host.close());
    // No owner session, launch link or connection file: the only way in is to sign in.
    expect(host.launchUrl).toBeUndefined();
    expect(host.connectionFile).toBeUndefined();

    /** The browser's part of a sign-in: the host's redirect, the provider's page, the callback. */
    async function signIn(email: string) {
      const manual = { redirect: 'manual' as const };
      const start = await fetch(`${host.url}/auth/sign-in`, manual);
      const authorize = new URL(start.headers.get('location')!);
      expect(authorize.origin).toBe(provider.issuer);
      const page = await fetch(authorize, { tls: { ca: tls.ca } });
      expect(await page.text()).toContain(`value="${email}"`);
      const chosen = await fetch(`${provider.issuer}/authorize`, {
        ...manual,
        method: 'POST',
        body: new URLSearchParams({ ...Object.fromEntries(authorize.searchParams), person: email }),
        tls: { ca: tls.ca },
      });
      const callback = await fetch(chosen.headers.get('location')!, manual);
      expect(callback.status).toBe(302);
      const name = sessionCookieName(host.url);
      return callback.headers.get('set-cookie')!.match(new RegExp(`${name}=([^;]+)`))![1]!;
    }
    const call = (cookie: string, kind: 'commands' | 'queries', operation: string, input: object) =>
      fetch(`${host.url}/api/v1/${kind}/${operation}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: host.url,
          cookie: `${sessionCookieName(host.url)}=${cookie}`,
        },
        body: JSON.stringify({ input, idempotencyKey: crypto.randomUUID() }),
      });
    const request = {
      sample: 'OS-24-0417',
      transformer: 'TR-40517',
      description: 'Gas alarm after a load increase',
    };

    const ana = await signIn('ana@lab.example');
    const submitted = await call(ana, 'commands', 'test-request.submit', request);
    expect(submitted.status).toBe(200);
    expect(((await submitted.json()) as { result: unknown }).result).toMatchObject({
      requester: 'ana@lab.example',
    });

    // A viewer reads the request and is refused a submission.
    const ben = await signIn('ben@lab.example');
    const list = await call(ben, 'queries', 'test-request.list', {});
    expect(((await list.json()) as { data: { items: unknown[] } }).data.items).toHaveLength(1);
    expect((await call(ben, 'commands', 'test-request.submit', request)).status).toBe(403);
  },
);

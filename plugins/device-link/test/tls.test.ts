import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeploymentPolicyInput } from '@tortoise/deployment/policy';
import { startHost } from '@tortoise/host/host';
import { LOCAL_USER, LOCAL_WORKSPACE } from '@tortoise/kernel/instance';
import { openMobileInstance } from '@tortoise/mobile';
import { hubLinkServiceOf } from '@tortoise/hub-link/plugin';
import { devicePlatform, fieldApplication, hubApplication } from './fixtures';

/** A throwaway local CA and a server certificate for `localhost` signed by it. */
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
  await openssl(
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-keyout',
    'local-ca.key',
    '-out',
    'local-ca.pem',
    '-subj',
    '/CN=local-ca',
  );
  await writeFile(
    join(directory, 'hub.ext'),
    'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n',
  );
  await openssl(
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'hub.key',
    '-out',
    'hub.csr',
    '-subj',
    '/CN=localhost',
  );
  await openssl(
    'x509',
    '-req',
    '-in',
    'hub.csr',
    '-CA',
    'local-ca.pem',
    '-CAkey',
    'local-ca.key',
    '-CAcreateserial',
    '-days',
    '1',
    '-out',
    'hub.pem',
    '-extfile',
    'hub.ext',
  );
}

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test.skipIf(!Bun.which('openssl'))(
  'a hub listens over TLS, and a phone that trusts the local CA pairs and delivers',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hub-'));
    const { platform, cleanup } = devicePlatform();
    try {
      await issueCertificates(directory);
      const port = await freePort();
      const policy: DeploymentPolicyInput = {
        profile: 'hub',
        grants: { maxTtlSeconds: 600 },
        ingress: { listen: 'tls', host: 'localhost', port, cert: 'hub.pem', key: 'hub.key' },
      };
      await writeFile(join(directory, 'deployment-policy.json'), JSON.stringify(policy));
      const hub = await startHost(hubApplication({ deployed: true }), {
        workspacePath: join(directory, 'workspace'),
        integration: false,
        settings: {
          'deployment-policy': join(directory, 'deployment-policy.json'),
          'device-link-sync-operations': 'captures.ingest,assignments.feed',
        },
      });
      try {
        expect(hub.url).toBe(`https://localhost:${port}`);
        // Without the local CA the phone cannot complete the handshake.
        await expect(fetch(`${hub.url}/health`, { keepalive: false })).rejects.toThrow();

        // The local CA reaches the phone through device management; here, through `fetch`.
        const ca = Bun.file(join(directory, 'local-ca.pem'));
        const trusting = ((input: string | URL | Request, init?: RequestInit) =>
          fetch(input, { ...init, tls: { ca } } as RequestInit)) as typeof fetch;
        const field = await openMobileInstance(fieldApplication({ fetch: trusting }), {
          platform,
        });
        try {
          const localUser = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_USER };
          const { result } = await hub.application.invokeRaw(
            {
              operation: 'link.enrollment.create',
              input: { label: 'Phone', kind: 'field-sync' },
              idempotencyKey: 'enroll-phone',
            },
            localUser,
          );
          const pairing = hubLinkServiceOf(field.instance.services)!;
          await pairing.pair({ origin: hub.url, code: (result as { code: string }).code });

          const photo = await field.transport.blobs!.put(
            new Uint8Array([255, 216, 1]),
            'image/jpeg',
          );
          await field.transport.command(
            'capture.record',
            { id: 'c1', note: 'nameplate', photo },
            { idempotencyKey: 'c1' },
          );
          expect(
            await field.instance.integrations
              .target('hub')
              .dispatcher.runOnce(undefined, { ignoreBackoff: true }),
          ).toMatchObject({ accepted: 1 });
          const { data } = await hub.application.queryRaw(
            { operation: 'captures.list', input: {} },
            localUser,
          );
          expect((data as { captures: unknown[] }).captures).toHaveLength(1);
        } finally {
          await field.close();
        }
      } finally {
        await hub.close();
      }
    } finally {
      cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SitePolicyInput } from '@agent-native/site/policy';
import { startHost } from '@agent-native/host/host';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from '@agent-native/kernel/authority';
import { openMobileAuthority } from '@agent-native/mobile';
import { hubLinkServiceOf } from '@agent-native/hub-link/plugin';
import { devicePlatform, fieldApplication, hubApplication } from './fixtures';

/** A throwaway site CA and a server certificate for `localhost` signed by it. */
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
    'site-ca.key',
    '-out',
    'site-ca.pem',
    '-subj',
    '/CN=site-ca',
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
    'site-ca.pem',
    '-CAkey',
    'site-ca.key',
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
  'a site hub listens over TLS, and a phone that trusts the site CA pairs and delivers',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'site-hub-'));
    const { platform, cleanup } = devicePlatform();
    try {
      await issueCertificates(directory);
      const port = await freePort();
      const policy: SitePolicyInput = {
        profile: 'site-hub',
        grants: { maxTtlSeconds: 600 },
        ingress: { listen: 'tls', host: 'localhost', port, cert: 'hub.pem', key: 'hub.key' },
      };
      await writeFile(join(directory, 'site-policy.json'), JSON.stringify(policy));
      const hub = await startHost(hubApplication({ site: true }), {
        workspacePath: join(directory, 'workspace'),
        integration: false,
        settings: {
          'site-policy': join(directory, 'site-policy.json'),
          'device-link-sync-operations': 'captures.ingest,assignments.feed',
        },
      });
      try {
        expect(hub.url).toBe(`https://localhost:${port}`);
        // Without the site CA the phone cannot complete the handshake.
        await expect(fetch(`${hub.url}/health`, { keepalive: false })).rejects.toThrow();

        // The site CA reaches the phone through device management; here, through `fetch`.
        const ca = Bun.file(join(directory, 'site-ca.pem'));
        const trusting = ((input: string | URL | Request, init?: RequestInit) =>
          fetch(input, { ...init, tls: { ca } } as RequestInit)) as typeof fetch;
        const field = await openMobileAuthority(fieldApplication({ fetch: trusting }), {
          platform,
        });
        try {
          const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };
          const { result } = await hub.application.invokeRaw(
            {
              operation: 'link.enrollment.create',
              input: { label: 'Phone', kind: 'field-sync' },
              idempotencyKey: 'enroll-phone',
            },
            owner,
          );
          const pairing = hubLinkServiceOf(field.authority.services)!;
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
            await field.authority.integrations
              .target('hub')
              .dispatcher.runOnce(undefined, { ignoreBackoff: true }),
          ).toMatchObject({ accepted: 1 });
          const { data } = await hub.application.queryRaw(
            { operation: 'captures.list', input: {} },
            owner,
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

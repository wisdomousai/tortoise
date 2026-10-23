import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditPlugin } from '@agent-native/audit/plugin';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { connectPeerTarget } from '@agent-native/integration';
import { startHost } from '@agent-native/host/host';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from '@agent-native/kernel/instance';
import { networkPlugin } from '@agent-native/network/plugin';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { sitePlugin } from '@agent-native/site/plugin';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import type { SitePolicyInput } from '@agent-native/site/policy';
import { conformanceEffect } from '@agent-native/testing/connectors';
import { peerLinkServiceOf } from '../src/service';
import { announce, qualityApplication, qualityTarget, receivingApplication } from './fixtures';

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
    join(directory, 'quality.ext'),
    'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n',
  );
  await openssl(
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'quality.key',
    '-out',
    'quality.csr',
    '-subj',
    '/CN=localhost',
  );
  await openssl(
    'x509',
    '-req',
    '-in',
    'quality.csr',
    '-CA',
    'site-ca.pem',
    '-CAkey',
    'site-ca.key',
    '-CAcreateserial',
    '-days',
    '1',
    '-out',
    'quality.pem',
    '-extfile',
    'quality.ext',
  );
}

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };
/** The plugins that open, bind and record the site network, as a site deployment composes them. */
const site = [
  { manifest: sitePluginManifest, plugin: sitePlugin },
  { manifest: networkPluginManifest, plugin: networkPlugin },
  { manifest: auditPluginManifest, plugin: auditPlugin },
];

test.skipIf(!Bun.which('openssl'))(
  'two applications connect over TLS through the site network, trusting the site CA',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'peer-tls-'));
    try {
      await issueCertificates(directory);
      const port = await freePort();
      const calleePolicy: SitePolicyInput = {
        profile: 'site-hub',
        grants: { maxTtlSeconds: 600 },
        ingress: {
          listen: 'tls',
          host: 'localhost',
          port,
          cert: 'quality.pem',
          key: 'quality.key',
        },
      };
      const callerPolicy: SitePolicyInput = {
        mode: 'connected',
        destinations: {
          'quality-api': {
            url: `https://localhost:${port}`,
            addresses: ['127.0.0.1/32', '::1/128'],
            ca: 'site-ca.pem',
          },
        },
      };
      await writeFile(join(directory, 'quality-policy.json'), JSON.stringify(calleePolicy));
      await writeFile(join(directory, 'receiving-policy.json'), JSON.stringify(callerPolicy));
      const quality = await startHost(qualityApplication({}, site), {
        workspacePath: join(directory, 'quality'),
        integration: false,
        settings: { 'site-policy': join(directory, 'quality-policy.json') },
      });
      try {
        expect(quality.url).toBe(`https://localhost:${port}`);
        // Without the site CA no client completes the handshake.
        await expect(fetch(`${quality.url}/health`, { keepalive: false })).rejects.toThrow();
        const receiving = await startHost(receivingApplication(site), {
          workspacePath: join(directory, 'receiving'),
          integration: false,
          settings: { 'site-policy': join(directory, 'receiving-policy.json') },
        });
        try {
          const { result } = await quality.application.invokeRaw(
            {
              operation: 'peer.enrollment.create',
              input: { label: 'Receiving' },
              idempotencyKey: 'tls-enroll',
            },
            owner,
          );
          const linked = peerLinkServiceOf(receiving.services)!;
          await linked.connect(
            { target: 'quality', code: (result as { code: string }).code },
            owner,
          );
          const port = connectPeerTarget({
            target: qualityTarget,
            application: receiving.application,
            workspaceId: owner.workspaceId,
            principalId: 'quality-integration',
            link: () => linked.link('quality'),
            readBlob: async () => undefined,
            reference: (outcome) => (outcome as { by: string }).by,
          }).port;
          const delivered = await port.deliver(
            {
              ...conformanceEffect({
                id: 'tls-1',
                target: 'quality',
                type: announce.id,
                payload: { lot: 'L1' },
              }),
              principalId: 'rita',
            },
            new AbortController().signal,
          );
          expect(delivered).toMatchObject({ status: 'accepted' });
        } finally {
          await receiving.close();
        }
      } finally {
        await quality.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

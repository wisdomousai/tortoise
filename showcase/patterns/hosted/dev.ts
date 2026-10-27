import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startIdentityProvider } from '@agent-native/site/testing';
import { labStaff } from './application';

/**
 * Run by `bun run dev:web` before the launch. It starts the stand-in identity provider on
 * https://127.0.0.1:4372 with the certificate and key that `LAB_IDP_CERT` and `LAB_IDP_KEY` name,
 * such as `mkcert 127.0.0.1` issues. It writes a site policy that signs people in through that
 * provider and trusts `LAB_IDP_CA`, the CA that issued the certificate, such as mkcert's
 * `rootCA.pem`. The workspace lives in the Postgres database `AGENT_NATIVE_DATABASE_URL` names.
 * An explicit `AGENT_NATIVE_SITE_POLICY` wins over the written policy.
 */
const { AGENT_NATIVE_DATABASE_URL, LAB_IDP_CERT, LAB_IDP_KEY, LAB_IDP_CA } = process.env;
const missing = Object.entries({ AGENT_NATIVE_DATABASE_URL, LAB_IDP_CERT, LAB_IDP_KEY, LAB_IDP_CA })
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missing.length) {
  console.error(
    `test-requests-hosted needs ${missing.join(', ')}. ` +
      'The README lists the database and certificate steps.',
  );
  process.exit(1);
}

const port = 4372;
const provider = await startIdentityProvider({
  port,
  clientId: 'test-requests',
  people: Object.entries(labStaff).map(([email, role]) => ({ email, name: `${email} (${role})` })),
  tls: { cert: readFileSync(LAB_IDP_CERT!, 'utf8'), key: readFileSync(LAB_IDP_KEY!, 'utf8') },
});

// A temporary directory, because the CA path in the policy is absolute.
const policy = join(mkdtempSync(join(tmpdir(), 'test-requests-hosted-')), 'site-policy.json');
writeFileSync(
  policy,
  JSON.stringify(
    {
      profile: 'desktop-local',
      mode: 'connected',
      audit: { mode: 'best-effort' },
      identity: 'external',
      workforce: { issuer: provider.issuer, clientId: 'test-requests' },
      destinations: { 'workforce-idp': { url: provider.issuer, ca: resolve(LAB_IDP_CA!) } },
    },
    null,
    2,
  ),
);
process.env.AGENT_NATIVE_SITE_POLICY ??= policy;
console.log(`Identity provider: ${provider.issuer}; policy: ${policy}`);

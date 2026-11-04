import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadManifest } from '@tortoise/host/config';
import { readMobileTarget } from '@tortoise/host/mobile-target';
import { deploymentCatalog } from '@tortoise/kernel/components';
import { associationFiles } from '@tortoise/shell/associations';

const root = resolve(import.meta.dir, '..');

/**
 * Write the association files a web host serves under `/.well-known/` so verified links open the
 * mobile app: `apple-app-site-association` and `assetlinks.json`, for the application
 * `app.config.json` names for mobile. The team id and certificate fingerprints are store
 * facts the person supplies; nothing here reads a signing key or a credential.
 */
export async function writeAssociations(options: {
  teamId: string;
  sha256Certs: readonly string[];
  out: string;
  configPath?: string;
  env?: Record<string, string | undefined>;
}) {
  const config = readMobileTarget(options.configPath ?? join(root, 'app.config.json'), options.env);
  const manifest = await loadManifest(config);
  const files = associationFiles(deploymentCatalog(manifest).os, {
    appId: config.appId,
    teamId: options.teamId,
    sha256Certs: options.sha256Certs,
  });
  await mkdir(options.out, { recursive: true });
  for (const [name, content] of Object.entries(files))
    await writeFile(join(options.out, name), `${JSON.stringify(content, null, 2)}\n`);
  return Object.keys(files).map((name) => join(options.out, name));
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      'team-id': { type: 'string' },
      'sha256-cert': { type: 'string', multiple: true },
      out: { type: 'string', default: join(root, 'dist', 'well-known') },
    },
  });
  if (!values['team-id'] || !values['sha256-cert']?.length)
    throw new Error(
      'Usage: bun scripts/os-associations.ts --team-id <id> --sha256-cert <fingerprint> [--out <dir>]',
    );
  const written = await writeAssociations({
    teamId: values['team-id'],
    sha256Certs: values['sha256-cert'],
    out: resolve(values.out!),
  });
  for (const path of written) console.log(`Wrote ${relative(root, path)}`);
}

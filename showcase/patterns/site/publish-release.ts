import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readConnection } from '@tortoise/adapters/cli/connection';
import type { BundleManifest } from '@tortoise/bundle';
import { createClient, createHttpTransport, type BlobReference } from '@tortoise/client';
import type { InputOf } from '@tortoise/contracts';
import { operations } from '@tortoise/fleet/contracts';

type Release = InputOf<typeof operations.releasePublish>['release'];

/**
 * Publish a signed site bundle to a fleet, as a build pipeline does. Each file under `files/` is
 * uploaded as a blob, then `release.publish` carries `bundle.json` and `bundle.sig` unchanged.
 * The release ID is the bundle's version. The fleet stores the signature without checking it; each
 * site verifies it against its own `fleet-trust` keys before staging. With `channel`, the channel
 * is pointed at the release.
 */
export async function publishRelease(
  client: ReturnType<typeof createClient>,
  bundle: string,
  channel?: string,
) {
  const blobs = client.transport.blobs;
  if (!blobs) throw new Error('The fleet keeps no blobs');
  const signed = await readFile(join(bundle, 'bundle.json'), 'utf8');
  const manifest = JSON.parse(signed) as BundleManifest;
  const files: BlobReference[] = [];
  for (const file of manifest.files)
    files.push(
      await blobs.put(
        new Uint8Array(await readFile(join(bundle, 'files', file.path))),
        'application/octet-stream',
      ),
    );
  const release: Release = {
    id: manifest.version,
    version: manifest.version,
    // The fleet keeps the manifest as the JSON the signature covers.
    manifest: JSON.parse(signed) as Release['manifest'],
    signature: JSON.parse(
      await readFile(join(bundle, 'bundle.sig'), 'utf8'),
    ) as Release['signature'],
  };
  const published = await client.command(operations.releasePublish, { release, files });
  if (channel)
    await client.command(operations.channelAssign, { id: channel, release: manifest.version });
  return published.result;
}

/**
 * `bun publish-release.ts <bundle dir> [--channel <id>]`, with `AGENT_NATIVE_CONNECTION` naming
 * the fleet's connection file, which holds the fleet owner's token on this machine.
 */
if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--channel');
  const channel = flag < 0 ? undefined : args.splice(flag, 2)[1];
  if (!args[0] || args.length > 1)
    throw new Error('Usage: bun publish-release.ts <bundle dir> [--channel <id>]');
  const { endpoint, token } = await readConnection();
  const client = createClient(createHttpTransport({ baseUrl: endpoint, token }));
  const release = await publishRelease(client, resolve(args[0]), channel);
  console.log(
    JSON.stringify({ release: release.id, files: release.files, channel: channel ?? null }),
  );
}

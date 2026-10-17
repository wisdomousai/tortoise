/**
 * A read-only npm registry on loopback that serves packed framework tarballs, so an application
 * can be installed from versions instead of workspace links before anything is published. It
 * answers package documents and tarball downloads for the packages in `directory` and 404 for
 * everything else; a `bunfig.toml` scope sends only `@agent-native/*` here. Holds no credentials
 * and accepts no uploads.
 */
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

interface Packed {
  readonly file: string;
  readonly manifest: { name: string; version: string; [key: string]: unknown };
  readonly integrity: string;
  readonly shasum: string;
}

/** The `package/package.json` of a tarball, as packed (workspace ranges already replaced). */
async function packedManifest(path: string): Promise<Packed['manifest']> {
  const tar = Bun.spawn(['tar', '-xzOf', path, 'package/package.json'], { stderr: 'pipe' });
  const [text, code] = await Promise.all([new Response(tar.stdout).text(), tar.exited]);
  if (code !== 0) throw new Error(`${path}: ${await new Response(tar.stderr).text()}`);
  return JSON.parse(text) as Packed['manifest'];
}

export async function readPacked(directory: string): Promise<Packed[]> {
  const packed: Packed[] = [];
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.tgz')).sort()) {
    const bytes = new Uint8Array(await Bun.file(join(directory, file)).arrayBuffer());
    packed.push({
      file,
      manifest: await packedManifest(join(directory, file)),
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      shasum: createHash('sha1').update(bytes).digest('hex'),
    });
  }
  return packed;
}

export interface LocalRegistry {
  readonly url: string;
  stop(): Promise<void>;
}

export async function startLocalRegistry(
  directory: string,
  options: { readonly port?: number } = {},
): Promise<LocalRegistry> {
  const packed = await readPacked(directory);
  const byName = new Map<string, Packed[]>();
  for (const item of packed)
    byName.set(item.manifest.name, [...(byName.get(item.manifest.name) ?? []), item]);
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: options.port ?? 0,
    async fetch(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return new Response('read-only registry', { status: 405 });
      const url = new URL(request.url);
      const path = decodeURIComponent(url.pathname.slice(1));
      const tarball = /^(?:.+\/)?-\/([^/]+\.tgz)$/.exec(path)?.[1];
      if (tarball) {
        const item = packed.find((candidate) => candidate.file === tarball);
        return item
          ? new Response(Bun.file(join(directory, item.file)), {
              headers: { 'content-type': 'application/octet-stream' },
            })
          : new Response('not found', { status: 404 });
      }
      const versions = byName.get(path);
      if (!versions) return new Response('{}', { status: 404 });
      const latest = versions.at(-1)!.manifest.version;
      return Response.json({
        name: path,
        'dist-tags': { latest },
        versions: Object.fromEntries(
          versions.map((item) => [
            item.manifest.version,
            {
              ...item.manifest,
              dist: {
                tarball: `${url.origin}/-/${item.file}`,
                integrity: item.integrity,
                shasum: item.shasum,
              },
            },
          ]),
        ),
      });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/`,
    stop: () => server.stop(true),
  };
}

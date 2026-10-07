import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { desktopTargets, type DesktopTarget } from '@agent-native/host/runtime-manifest';

export const runtimeVersions = { codex: '0.160.1', claude: '0.3.292', keyring: '2.1.0' } as const;
export function targetPackages(target: DesktopTarget) {
  if (!desktopTargets.includes(target)) throw new Error(`Unsupported desktop target: ${target}`);
  const keyring = {
    'darwin-arm64': 'darwin-arm64',
    'darwin-x64': 'darwin-x64',
    'win32-x64': 'win32-x64-msvc',
    'linux-x64': 'linux-x64-gnu',
  }[target];
  return {
    codex: { name: '@openai/codex', version: `${runtimeVersions.codex}-${target}` },
    claude: { name: `@anthropic-ai/claude-agent-sdk-${target}`, version: runtimeVersions.claude },
    keyring: { name: `@napi-rs/keyring-${keyring}`, version: runtimeVersions.keyring },
  };
}
export function verifyIntegrity(bytes: Uint8Array, integrity: string) {
  const [algorithm, expected] = integrity.split('-');
  if (algorithm !== 'sha512' || !expected)
    throw new Error('Native package requires sha512 registry integrity');
  const actual = createHash('sha512').update(bytes).digest();
  const digest = Buffer.from(expected, 'base64');
  if (actual.length !== digest.length || !timingSafeEqual(actual, digest))
    throw new Error('Native package registry integrity mismatch');
}
/** Minimal npm tar reader: only files/directories and PAX metadata are accepted.
 * Package links, device files and traversal paths are refused before any write. */
export function readNpmTarball(
  compressed: Uint8Array,
): { path: string; bytes: Buffer; executable: boolean }[] {
  const tar = gunzipSync(compressed, { maxOutputLength: 800 * 1024 * 1024 });
  const files: { path: string; bytes: Buffer; executable: boolean }[] = [];
  let paxPath: string | undefined;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const field = (start: number, length: number) =>
      header
        .subarray(start, start + length)
        .toString('utf8')
        .replace(/\0.*$/s, '')
        .trim();
    const sizeText = field(124, 12);
    if (!/^[0-7]+$/.test(sizeText)) throw new Error('Unsupported tar size');
    const size = Number.parseInt(sizeText, 8);
    if (offset + size > tar.length) throw new Error('Truncated native package tarball');
    const bytes = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    const type = field(156, 1);
    if (type === 'x' || type === 'g') {
      const metadata = bytes.toString('utf8');
      for (const line of metadata.split('\n')) {
        const match = line.match(/^\d+ path=(.+)$/);
        if (match) paxPath = match[1];
      }
      continue;
    }
    if (type !== '' && type !== '0' && type !== '5')
      throw new Error('Native package contains unsupported link or special file');
    const prefix = field(345, 155);
    const raw = paxPath ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    paxPath = undefined;
    if (
      raw.startsWith('/') ||
      raw.includes('\\') ||
      raw.split('/').includes('..') ||
      !raw.startsWith('package/')
    )
      throw new Error('Unsafe native package path');
    const path = posix.normalize(raw.slice('package/'.length));
    if (type === '5') continue;
    if (!path || path === '.' || path.includes('\0') || path.includes(':'))
      throw new Error('Unsafe native package file');
    files.push({ path, bytes, executable: (Number.parseInt(field(100, 8), 8) & 0o111) !== 0 });
  }
  if (!files.length) throw new Error('Native package contains no files');
  return files;
}
export async function downloadNativePackage(
  spec: { name: string; version: string },
  destination: string,
) {
  const metadataUrl = `https://registry.npmjs.org/${encodeURIComponent(spec.name)}/${encodeURIComponent(spec.version)}`;
  const metadataResponse = await fetch(metadataUrl, {
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  });
  if (!metadataResponse.ok)
    throw new Error(`Native package metadata unavailable: ${spec.name}@${spec.version}`);
  const metadata = (await metadataResponse.json()) as {
    name: string;
    version: string;
    dist: { tarball: string; integrity: string };
  };
  if (metadata.name !== spec.name || metadata.version !== spec.version)
    throw new Error('Registry native package identity mismatch');
  const tarballUrl = new URL(metadata.dist.tarball);
  if (tarballUrl.protocol !== 'https:' || tarballUrl.hostname !== 'registry.npmjs.org')
    throw new Error('Untrusted native package tarball origin');
  const response = await fetch(tarballUrl, {
    signal: AbortSignal.timeout(180_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Native package download failed: ${spec.name}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 400 * 1024 * 1024) throw new Error('Native package download exceeded limit');
  verifyIntegrity(bytes, metadata.dist.integrity);
  const files = readNpmTarball(bytes);
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) throw new Error('Duplicate native package path');
    seen.add(file.path);
    const path = join(destination, ...file.path.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.bytes, { flag: 'wx', mode: file.executable ? 0o755 : 0o644 });
    if (file.executable) await chmod(path, 0o755);
  }
}
export async function listFiles(root: string, directory = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink())
      throw new Error('Native resource symlinks must not escape packaging');
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await listFiles(root, path)));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}
export async function sha256(path: string) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

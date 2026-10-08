import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { ApplicationError, canonicalJson } from '@agent-native/contracts';
import type { HarnessTurn } from '@agent-native/agents/types';
import { loadRuntimeManifest, resourcePath } from '../runtime-manifest';
import { digest } from './state';

/** Every resource must resolve inside the packaged directory and match its manifest digest. */
async function verifyResource(root: string, file: { path: string; sha256: string }) {
  const path = await realpath(resourcePath(root, file.path));
  const boundary = relative(root, path);
  if (
    !boundary ||
    boundary === '..' ||
    boundary.startsWith(`..${sep}`) ||
    isAbsolute(boundary) ||
    !(await stat(path)).isFile()
  )
    throw new ApplicationError('INVALID_INPUT', 'Runtime resource escapes its packaged directory');
  const bytes = await readFile(path);
  if (
    !/^[a-f0-9]{64}$/.test(file.sha256) ||
    createHash('sha256').update(bytes).digest('hex') !== file.sha256
  )
    throw new ApplicationError('INVALID_INPUT', 'Native runtime integrity check failed');
}

/**
 * The bundled native provider runtime, after checking the manifest's packaged filename, every
 * resource's digest and the executable bit. Nothing on PATH is ever used.
 */
export async function verifiedRuntime(
  runtimeManifest: string | undefined,
  kind: 'codex' | 'claude',
): Promise<string> {
  if (!runtimeManifest || !isAbsolute(runtimeManifest))
    throw new ApplicationError('NOT_FOUND', 'A bundled native runtime manifest is required');
  const root = await realpath(dirname(runtimeManifest));
  if ((await realpath(runtimeManifest)) !== join(root, 'runtime-manifest.json'))
    throw new ApplicationError('INVALID_INPUT', 'Runtime manifest must use its packaged filename');
  const manifest = await loadRuntimeManifest(root);
  const descriptor = manifest.runtimes[kind];
  if (!descriptor.files.some((file) => file.path === descriptor.executable))
    throw new ApplicationError('INVALID_INPUT', 'Runtime executable digest is missing');
  for (const file of descriptor.files) await verifyResource(root, file);
  const executable = await realpath(resourcePath(root, descriptor.executable));
  await access(executable, constants.X_OK);
  return executable;
}

/** A per-run working directory and a per-conversation HOME, both private to the owner. */
export async function providerDirectories(
  workspacePath: string,
  turn: HarnessTurn,
  kind: string,
  key: string,
) {
  const cwd = join(workspacePath, 'provider-runs', digest(turn.runId).slice(0, 32), kind, 'work');
  // Native thread/session persistence is conversation-scoped, while funding profiles
  // stay isolated. A per-run HOME would silently make the next resume unavailable.
  const home = join(
    workspacePath,
    'provider-conversations',
    digest(
      canonicalJson([
        key,
        turn.conversationId,
        kind,
        turn.context.profileId ?? turn.context.providerAccount ?? null,
      ]),
    ).slice(0, 32),
    'home',
  );
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  await mkdir(home, { recursive: true, mode: 0o700 });
  return { cwd, home };
}

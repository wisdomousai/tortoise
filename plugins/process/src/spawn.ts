import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ResolvedProcess } from '@agent-native/site/policy';

/**
 * The only place the process plugin touches the operating system's process API. Everything that
 * decides what may run lives in `open.ts`; this file starts, hashes and stops.
 */

/** Variables a child needs to find temporary space and its locale; nothing else is inherited. */
const inherited = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL'] as const;

export function baseEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of inherited) if (process.env[key]) env[key] = process.env[key]!;
  return env;
}

/** SHA-256 of a file, lower-case hex. Rejects when the file cannot be read. */
export function digestFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Start the bound executable with an argument vector, never a shell. On POSIX the child leads its
 * own process group so the whole tree can be stopped. Resolves once the OS has started it.
 */
export function startChild(
  binding: ResolvedProcess,
  args: readonly string[],
  env: Record<string, string>,
): Promise<ChildProcessWithoutNullStreams> {
  return new Promise((resolve, reject) => {
    const child = spawn(binding.executable, [...binding.args, ...args], {
      cwd: binding.cwd ?? dirname(binding.executable),
      env,
      stdio: 'pipe',
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    child.once('spawn', () => resolve(child));
    child.once('error', reject);
  });
}

/** Stop the child's process tree: its POSIX group, or `taskkill /T` by absolute path on Windows. */
export function terminateTree(child: ChildProcessWithoutNullStreams, force: boolean) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot ?? process.env.WINDIR;
    if (!root) return void child.kill();
    spawn(join(root, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    }).on('error', () => child.kill());
    return;
  }
  const signal = force ? 'SIGKILL' : 'SIGTERM';
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    // macOS answers EPERM for a group whose leader exited but is not reaped yet (its exit event
    // is still pending); signalling the child itself is then a no-op instead of a throw.
    if (code === 'EPERM') child.kill(signal);
    else if (code !== 'ESRCH') throw error;
  }
}

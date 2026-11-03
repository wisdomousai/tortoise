import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Start the real starter service for one application on an ephemeral port and wait for its
 * listening line. It serves that application's web build (`globalSetup` builds every example).
 * `cwd` runs the service of another checkout, such as a fresh export.
 */
export async function startService(
  application: string,
  workspace: string,
  env: Record<string, string> = {},
  cwd: string = process.cwd(),
) {
  let child: ChildProcess | undefined;
  const started = await new Promise<{ launchUrl: string; connectionFile: string }>(
    (resolveStarted, reject) => {
      child = spawn('bun', ['apps/service/src/index.ts'], {
        cwd,
        env: {
          ...process.env,
          AGENT_NATIVE_APPLICATION: application,
          WORKSPACE_PATH: workspace,
          PORT: '0',
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let buffer = '';
      let errors = '';
      child.stderr!.on('data', (data) => {
        errors += data.toString();
      });
      child.stdout!.on('data', (data) => {
        buffer += data.toString();
        const line = buffer.split('\n').find((value) => value.startsWith('{'));
        if (line) {
          try {
            const value = JSON.parse(line);
            if (value.type === 'listening') resolveStarted(value);
          } catch {}
        }
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code) reject(new Error(`Service exited: ${errors}`));
      });
    },
  );
  return {
    ...started,
    origin: new URL(started.launchUrl).origin,
    async stop() {
      if (child && child.exitCode === null) {
        const stopped = new Promise((resolve) => child!.once('exit', resolve));
        child.kill('SIGTERM');
        await stopped;
      }
    },
  };
}

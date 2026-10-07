import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import {
  loadRuntimeManifest,
  resourcePath,
  verifyRuntimeFiles,
} from '../apps/desktop/src/runtime-manifest';
import { ensureService } from '../apps/desktop/src/service-lifecycle';
import { nativeEnvironment } from '../packages/agents/src/process';
/** Offline platform acceptance: real shipped native versions and compiled service.
 * Never invokes provider inference or the OS credential store. Run on each target. */
export async function smokeStage(stage: string) {
  const resources = resolve(stage, 'resources');
  const manifest = await loadRuntimeManifest(resources);
  await verifyRuntimeFiles(resources, manifest, true);
  const workspace = await mkdtemp(resolve(tmpdir(), 'agent-native-package-smoke-'));
  const versions: Record<string, string> = {};
  try {
    for (const name of ['codex', 'claude'] as const) {
      versions[name] = await new Promise<string>((done, reject) => {
        const child = spawn(
          resourcePath(resources, manifest.runtimes[name].executable),
          ['--version'],
          {
            cwd: workspace,
            env: nativeEnvironment({
              HOME: workspace,
              USERPROFILE: workspace,
              CODEX_HOME: workspace,
              CLAUDE_CONFIG_DIR: workspace,
            }),
            stdio: 'pipe',
            windowsHide: true,
          },
        );
        let output = '';
        child.stdout.setEncoding('utf8');
        child.stderr.resume();
        child.stdout.on('data', (chunk: string) => {
          output += chunk;
          if (output.length > 8000) {
            child.kill();
            reject(new Error('Native version output exceeded limit'));
          }
        });
        const timeout = setTimeout(() => {
          child.kill();
          reject(new Error(`${name} version probe timed out`));
        }, 10_000);
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timeout);
          code === 0 ? done(output.trim()) : reject(new Error(`${name} version probe failed`));
        });
      });
    }
    const service = await ensureService({
      workspace,
      executable: resourcePath(resources, manifest.service.executable),
      webRoot: resourcePath(resources, manifest.webRoot),
      runtimeManifest: resolve(resources, 'runtime-manifest.json'),
    });
    try {
      if (!service.owned)
        throw new Error('Fresh smoke workspace unexpectedly attached to another authority');
      const response = await fetch(service.endpoint, {
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!response.ok || !(await response.text()).includes('<html'))
        throw new Error('Packaged frontend was not served');
      process.stdout.write(
        JSON.stringify({
          target: manifest.target,
          nativeVersions: versions,
          compiledService: 'passed',
          webAssets: 'passed',
          inference: 'not-run',
          credentialStore: 'not-run',
        }) + '\n',
      );
    } finally {
      await service.stop();
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
if (import.meta.main)
  await smokeStage(
    resolve(process.argv[2] ?? `artifacts/desktop/${process.platform}-${process.arch}`),
  );

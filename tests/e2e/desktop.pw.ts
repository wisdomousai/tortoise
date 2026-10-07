import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const executablePath = process.env.DESKTOP_EXECUTABLE;
test.skip(
  !executablePath,
  'Set DESKTOP_EXECUTABLE to an already packaged native application executable.',
);
test.describe.configure({ mode: 'serial', timeout: 120_000 });

function nativeEnvironment(workspace: string): Record<string, string> {
  const env: Record<string, string> = {
    PATH:
      process.platform === 'win32' ? (process.env.SystemRoot ?? 'C:\\Windows') : '/usr/bin:/bin',
    AGENT_NATIVE_WORKSPACE: workspace,
  };
  for (const key of [
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'DBUS_SESSION_BUS_ADDRESS',
    'XDG_RUNTIME_DIR',
    'DISPLAY',
    'WAYLAND_DISPLAY',
  ])
    if (process.env[key]) env[key] = process.env[key]!;
  return env;
}
async function launch(workspace: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: resolve(executablePath!),
    env: nativeEnvironment(workspace),
    timeout: 45_000,
  });
}
async function connection(workspace: string): Promise<{ endpoint: string; token: string }> {
  return JSON.parse(await readFile(join(workspace, '.connection.json'), 'utf8'));
}
async function call(
  connection: { endpoint: string; token: string },
  operation: string,
  input: unknown,
  command?: { key: string; revisions?: Record<string, number> },
) {
  const response = await fetch(
    `${connection.endpoint}/api/v1/${command ? 'commands' : 'queries'}/${operation}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        input,
        ...(command ? { idempotencyKey: command.key, expectedRevisions: command.revisions } : {}),
      }),
    },
  );
  expect(response.ok).toBe(true);
  return response.json();
}
async function health(endpoint: string) {
  try {
    return (await fetch(endpoint + '/health', { signal: AbortSignal.timeout(500) })).ok;
  } catch {
    return false;
  }
}

test('packaged Electron uses its bundled authority with no runtime on PATH, reacts to external writes and reopens persisted data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native desktop acceptance '));
  const workspace = join(directory, 'workspace with spaces');
  let app: ElectronApplication | undefined;
  try {
    app = await launch(workspace);
    const page = await app.firstWindow();
    await page.getByLabel('New project').fill('Native acceptance');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Native acceptance' })).toBeVisible();
    await page.getByLabel('New task title').fill('Created in native Electron');
    await page.getByRole('button', { name: 'Add task', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Created in native Electron', exact: true }),
    ).toBeVisible();
    const nativeWindow = await app.browserWindow(page);
    expect(
      await nativeWindow.evaluate((window) => {
        const options = window.webContents.getLastWebPreferences();
        return {
          sandbox: options.sandbox,
          contextIsolation: options.contextIsolation,
          nodeIntegration: options.nodeIntegration,
          webSecurity: options.webSecurity,
          webviewTag: options.webviewTag,
        };
      }),
    ).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    });
    expect(
      await page.evaluate(() => ({
        require: typeof (globalThis as { require?: unknown }).require,
        process: typeof (globalThis as { process?: unknown }).process,
      })),
    ).toEqual({ require: 'undefined', process: 'undefined' });
    const authority = await connection(workspace);
    const tasks = await call(authority, 'task.list', {});
    const task = tasks.data.items[0] as { id: string; revision: number };
    await call(
      authority,
      'task.update',
      { id: task.id, title: 'External HTTP update in native window' },
      { key: 'native-external', revisions: { [`task:${task.id}`]: task.revision } },
    );
    await expect(
      page.getByRole('button', { name: 'External HTTP update in native window', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('native-desktop.png'), fullPage: true });
    await app.close();
    app = undefined;
    await expect.poll(() => health(authority.endpoint), { timeout: 10_000 }).toBe(false);
    // A successful fresh authority start proves that the earlier owned service released its OS lock.
    app = await launch(workspace);
    const reopened = await app.firstWindow();
    await expect(reopened.getByRole('heading', { name: 'Native acceptance' })).toBeVisible();
    await expect(
      reopened.getByRole('button', { name: 'External HTTP update in native window', exact: true }),
    ).toBeVisible();
    await app.close();
    app = undefined;
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('closing an attached native frontend leaves the pre-existing bundled service running', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native attached authority '));
  const workspace = join(directory, 'attached workspace with spaces');
  await mkdir(workspace);
  const resources =
    process.platform === 'darwin'
      ? resolve(dirname(executablePath!), '../Resources/application')
      : resolve(dirname(executablePath!), 'resources/application');
  const manifestPath = join(resources, 'runtime-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    service: { executable: string };
    webRoot: string;
  };
  let child: ChildProcessWithoutNullStreams | undefined;
  let app: ElectronApplication | undefined;
  try {
    const ready = new Promise<string>((resolveReady, reject) => {
      child = spawn(resolve(resources, manifest.service.executable), [], {
        cwd: workspace,
        env: {
          ...nativeEnvironment(workspace),
          WORKSPACE_PATH: workspace,
          PORT: '0',
          WEB_ROOT: resolve(resources, manifest.webRoot),
          AGENT_RUNTIME_MANIFEST: manifestPath,
        },
        stdio: 'pipe',
      });
      let buffer = '';
      let errors = '';
      const timer = setTimeout(
        () => reject(new Error(`Bundled authority startup timed out: ${errors}`)),
        30_000,
      );
      child.stdout.on('data', (data) => {
        buffer += data.toString();
        let boundary: number;
        while ((boundary = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 1);
          try {
            const event = JSON.parse(line);
            if (event.type === 'listening') {
              clearTimeout(timer);
              resolveReady(event.url);
            }
          } catch {}
        }
      });
      child.stderr.on('data', (data) => {
        errors = (errors + data.toString()).slice(-8000);
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Bundled authority exited (${code}): ${errors}`));
      });
    });
    const endpoint = await ready;
    app = await launch(workspace);
    const page = await app.firstWindow();
    await page.getByLabel('New project').fill('Attached authority');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Attached authority' })).toBeVisible();
    await app.close();
    app = undefined;
    expect(child!.exitCode).toBeNull();
    expect(await health(endpoint)).toBe(true);
    const projects = await call(await connection(workspace), 'project.list', {});
    expect(projects.data.items[0].name).toBe('Attached authority');
  } finally {
    await app?.close();
    if (child && child.exitCode === null) {
      const stopped = new Promise<void>((done) => child!.once('exit', () => done()));
      child.kill('SIGTERM');
      const killTimer = setTimeout(() => {
        if (child?.exitCode === null) child.kill('SIGKILL');
      }, 5000);
      await stopped;
      clearTimeout(killTimer);
    }
    await rm(directory, { recursive: true, force: true });
  }
});

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface ServiceConnection {
  endpoint: string;
  token: string;
}
export interface ServiceHandle {
  endpoint: string;
  launchUrl: string;
  owned: boolean;
  child?: ChildProcessWithoutNullStreams;
  stop(): Promise<void>;
}
export function validateLoopbackEndpoint(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Service endpoint is not a plain loopback origin');
  return url.origin;
}
async function readConnection(workspace: string): Promise<ServiceConnection> {
  const file = resolve(workspace, '.connection.json');
  const info = await lstat(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
  )
    throw new Error('Service connection file is not private');
  const connection: ServiceConnection = JSON.parse(await readFile(file, 'utf8'));
  connection.endpoint = validateLoopbackEndpoint(connection.endpoint);
  if (typeof connection.token !== 'string' || connection.token.length < 32)
    throw new Error('Service connection token is missing');
  return connection;
}
async function connect(
  workspace: string,
): Promise<{ connection: ServiceConnection; launchUrl: string }> {
  const connection = await readConnection(workspace);
  const headers = { Authorization: `Bearer ${connection.token}` };
  const contract = await fetch(`${connection.endpoint}/api/v1/contract`, {
    headers,
    signal: AbortSignal.timeout(3_000),
    redirect: 'error',
  });
  if (!contract.ok) throw new Error('Existing authority handshake failed');
  const response = await fetch(`${connection.endpoint}/api/v1/launch`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(3_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Existing authority could not bootstrap a browser session');
  const body = (await response.json()) as { launch?: string };
  if (!body.launch || typeof body.launch !== 'string')
    throw new Error('Authority returned no launch credential');
  return {
    connection,
    launchUrl: `${connection.endpoint}/#launch=${encodeURIComponent(body.launch)}`,
  };
}

/** Attach first; otherwise let the service's OS-held workspace lock arbitrate startup.
 * Only the exact child process launched here is owned and eligible for shutdown.
 * `extraEnv` is for the source development launch. Workspace, port, web root, runtime
 * manifest and site policy are applied after it, so those keys cannot be overridden.
 * Packaged startup does not set `extraEnv`. */
export async function ensureService(options: {
  workspace: string;
  executable: string;
  args?: string[];
  webRoot: string;
  runtimeManifest?: string;
  /** Site policy file for the service; absent leaves the service isolated (loopback only). */
  sitePolicy?: string;
  startupTimeoutMs?: number;
  /** Listen port for a service this host starts. Packaged startup leaves this unset (`0`). */
  port?: string;
  /** Repository root for a source service. The packaged executable ignores `cwd`. */
  cwd?: string;
  /** Developer environment for a source service. Applied before the host-owned keys. */
  extraEnv?: Record<string, string>;
  /** Copy the child authority's output to this process. Development launches use this. */
  mirror?: boolean;
}): Promise<ServiceHandle> {
  const workspace = await realpath(options.workspace);
  try {
    const existing = await connect(workspace);
    return {
      endpoint: existing.connection.endpoint,
      launchUrl: existing.launchUrl,
      owned: false,
      async stop() {},
    };
  } catch {
    /* A stale descriptor is never deleted here. The service lock decides. */
  }
  const env: NodeJS.ProcessEnv = {};
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
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
  ])
    if (process.env[key]) env[key] = process.env[key];
  if (options.extraEnv) Object.assign(env, options.extraEnv);
  // Host-owned keys win over anything the development environment carried.
  Object.assign(env, {
    PORT: options.port ?? '0',
    WORKSPACE_PATH: workspace,
    WEB_ROOT: options.webRoot,
  });
  if (options.runtimeManifest) env.AGENT_RUNTIME_MANIFEST = options.runtimeManifest;
  if (options.sitePolicy) env.AGENT_NATIVE_SITE_POLICY = options.sitePolicy;
  const child = spawn(options.executable, options.args ?? [], {
    cwd: options.cwd ?? workspace,
    env,
    stdio: 'pipe',
    windowsHide: true,
  });
  let stopped = false;
  let ownedInstance: string | undefined;
  if (options.mirror) child.stderr.pipe(process.stderr);
  else child.stderr.resume();
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (child.exitCode !== null) return;
    if (ownedInstance)
      try {
        const authority = JSON.parse(
          await readFile(resolve(workspace, '.authority.json'), 'utf8'),
        ) as { instance?: string };
        // A failed competing launch must never stop the existing authority through a
        // shared connection file. The instance must match our child's ready message.
        if (authority.instance === ownedInstance) {
          const connection = await readConnection(workspace);
          await fetch(`${connection.endpoint}/api/v1/shutdown`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${connection.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ instance: ownedInstance }),
            signal: AbortSignal.timeout(1_000),
            redirect: 'error',
          });
        }
      } catch {
        /* Older service versions still receive a termination signal. */
      }
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise<void>((resolveStop) => {
      const timeout = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
        resolveStop();
      }, 2_000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolveStop();
      });
    });
  };
  try {
    await new Promise<void>((ready, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Local authority startup timed out')),
        options.startupTimeoutMs ?? 15_000,
      );
      let buffer = '';
      const cleanup = () => {
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        child.off('error', onError);
        child.off('exit', onExit);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onExit = () => {
        cleanup();
        reject(new Error('Local authority exited before becoming ready'));
      };
      const onData = (chunk: Buffer) => {
        if (options.mirror) process.stdout.write(chunk);
        buffer += chunk.toString('utf8');
        if (buffer.length > 65_536) {
          cleanup();
          reject(new Error('Local authority startup output exceeded limit'));
          return;
        }
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const event = JSON.parse(line);
            if (event.type === 'listening' && typeof event.instance === 'string') {
              validateLoopbackEndpoint(event.url);
              ownedInstance = event.instance;
              cleanup();
              if (options.mirror) child.stdout.pipe(process.stdout);
              else child.stdout.resume();
              ready();
              return;
            }
          } catch {
            /* Non-protocol log lines do not grant authority or expose tokens. */
          }
        }
      };
      child.stdout.on('data', onData);
      child.once('error', onError);
      child.once('exit', onExit);
    });
    const current = await connect(workspace);
    return {
      endpoint: current.connection.endpoint,
      launchUrl: current.launchUrl,
      owned: true,
      child,
      stop,
    };
  } catch (error) {
    await stop();
    // Another frontend may have won the lock between our initial read and spawn.
    try {
      const existing = await connect(workspace);
      return {
        endpoint: existing.connection.endpoint,
        launchUrl: existing.launchUrl,
        owned: false,
        async stop() {},
      };
    } catch {
      throw error;
    }
  }
}

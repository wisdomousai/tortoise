import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface ServiceConnection {
  endpoint: string;
  token: string;
}
export interface ServiceHandle {
  endpoint: string;
  /** The connection-file session; the launch URL signs the window in as the same session. */
  token: string;
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
  if (!contract.ok) throw new Error('Existing instance handshake failed');
  const response = await fetch(`${connection.endpoint}/api/v1/launch`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(3_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Existing instance could not bootstrap a browser session');
  const body = (await response.json()) as { launch?: string };
  if (!body.launch || typeof body.launch !== 'string')
    throw new Error('Instance returned no launch credential');
  return {
    connection,
    launchUrl: `${connection.endpoint}/#launch=${encodeURIComponent(body.launch)}`,
  };
}

interface ServiceOptions {
  workspace: string;
  executable: string;
  args?: string[];
  webRoot: string;
  runtimeManifest?: string;
  /** Site policy file for the service; absent leaves the service isolated (loopback only). */
  sitePolicy?: string;
  /** The application's URL scheme, passed to the OS plugin as `AGENT_NATIVE_OS_SCHEME`. */
  scheme?: string;
  startupTimeoutMs?: number;
  /** Listen port for a service this host starts. Packaged startup leaves this unset (`0`). */
  port?: string;
  /** Repository root for a source service. The packaged executable ignores `cwd`. */
  cwd?: string;
  /** Developer environment for a source service. Applied before the host-owned keys. */
  extraEnv?: Record<string, string>;
  /** Copy the child instance's output to this process. Development launches use this. */
  mirror?: boolean;
}

/** A handle on an instance someone else started; this frontend never stops it. */
const attached = (existing: Awaited<ReturnType<typeof connect>>): ServiceHandle => ({
  endpoint: existing.connection.endpoint,
  token: existing.connection.token,
  launchUrl: existing.launchUrl,
  owned: false,
  async stop() {},
});

/**
 * A minimal environment: a few OS keys, then `extraEnv`, then the host-owned keys, which win
 * over anything the development environment carried.
 */
function serviceEnvironment(options: ServiceOptions, workspace: string): NodeJS.ProcessEnv {
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
  // The OS plugin handles links in this scheme; an application without it ignores the key.
  if (options.scheme) env.AGENT_NATIVE_OS_SCHEME = options.scheme;
  return env;
}

/** The child launched here and the instance id from its ready message, once received. */
interface OwnedService {
  readonly child: ChildProcessWithoutNullStreams;
  readonly workspace: string;
  ownedInstance?: string;
  stopped: boolean;
}

/** Ask the instance to shut down, but only if it is still the instance this child announced. */
async function requestShutdown(workspace: string, instance: string) {
  try {
    const metadata = JSON.parse(await readFile(resolve(workspace, '.instance.json'), 'utf8')) as {
      instance?: string;
    };
    // A failed competing launch must never stop the existing instance through a
    // shared connection file. The instance must match our child's ready message.
    if (metadata.instance === instance) {
      const connection = await readConnection(workspace);
      await fetch(`${connection.endpoint}/api/v1/shutdown`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${connection.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ instance }),
        signal: AbortSignal.timeout(1_000),
        redirect: 'error',
      });
    }
  } catch {
    /* Older service versions still receive a termination signal. */
  }
}

/** Stop once: a graceful shutdown request, then SIGTERM, then SIGKILL after two seconds. */
async function stopService(service: OwnedService) {
  const { child } = service;
  if (service.stopped) return;
  service.stopped = true;
  if (child.exitCode !== null) return;
  if (service.ownedInstance) await requestShutdown(service.workspace, service.ownedInstance);
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
}

/**
 * Wait for the child's `listening` line on stdout and record its instance id. Output is bounded,
 * and only a protocol line with a loopback URL counts as ready.
 */
function awaitReady(service: OwnedService, options: ServiceOptions): Promise<void> {
  const { child } = service;
  return new Promise<void>((ready, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Local host startup timed out')),
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
      reject(new Error('Local host exited before becoming ready'));
    };
    const onData = (chunk: Buffer) => {
      if (options.mirror) process.stdout.write(chunk);
      buffer += chunk.toString('utf8');
      if (buffer.length > 65_536) {
        cleanup();
        reject(new Error('Local host startup output exceeded limit'));
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
            service.ownedInstance = event.instance;
            cleanup();
            if (options.mirror) child.stdout.pipe(process.stdout);
            else child.stdout.resume();
            ready();
            return;
          }
        } catch {
          /* Non-protocol log lines grant no access and expose no tokens. */
        }
      }
    };
    child.stdout.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

/** Attach first; otherwise let the service's OS-held workspace lock arbitrate startup.
 * Only the exact child process launched here is owned and eligible for shutdown.
 * `extraEnv` is for the source development launch. Workspace, port, web root, runtime
 * manifest and site policy are applied after it, so those keys cannot be overridden.
 * Packaged startup does not set `extraEnv`. */
export async function ensureService(options: ServiceOptions): Promise<ServiceHandle> {
  const workspace = await realpath(options.workspace);
  try {
    return attached(await connect(workspace));
  } catch {
    /* A stale descriptor is never deleted here. The service lock decides. */
  }
  const child = spawn(options.executable, options.args ?? [], {
    cwd: options.cwd ?? workspace,
    env: serviceEnvironment(options, workspace),
    stdio: 'pipe',
    windowsHide: true,
  });
  const service: OwnedService = { child, workspace, stopped: false };
  if (options.mirror) child.stderr.pipe(process.stderr);
  else child.stderr.resume();
  const stop = () => stopService(service);
  try {
    await awaitReady(service, options);
    const current = await connect(workspace);
    return {
      endpoint: current.connection.endpoint,
      token: current.connection.token,
      launchUrl: current.launchUrl,
      owned: true,
      child,
      stop,
    };
  } catch (error) {
    await stop();
    // Another frontend may have won the lock between our initial read and spawn.
    try {
      return attached(await connect(workspace));
    } catch {
      throw error;
    }
  }
}

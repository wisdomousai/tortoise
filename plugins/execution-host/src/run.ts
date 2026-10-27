import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { ApplicationError, type AuditRecord } from '@agent-native/contracts';
import {
  bunProcesses,
  childEnvironment,
  type HostPorts,
  type ProcessAvailability,
  type SpawnedProcess,
} from '@agent-native/host/plugin';
import type { ExecutionContext } from '@agent-native/runtime';
import type { Broker } from './broker';
import {
  bwrapArguments,
  bwrapCommand,
  encodeArguments,
  sandboxPaths,
  systemPaths,
  toolPath,
  type HostEntry,
} from './bwrap';
import { kernelLimits, resolveLimits, type SandboxLimits } from './limits';
import { startRelay, type Relay } from './relay';
import { seccompArch, seccompFilter } from './seccomp';

/** One task for a sandbox. The trusted caller builds it; nothing here comes from the sandbox. */
export interface SandboxTask {
  /** The declared sandbox process (`executionSandbox`) to run in. */
  readonly sandbox: string;
  /** A declared tool by name, then its arguments. */
  readonly command: readonly [string, ...string[]];
  /** Who the sandbox acts as. It must carry a grant; the sandbox's token ends with the run. */
  readonly context: ExecutionContext;
  /** A host directory bound read-write at `/work`; a private empty one when absent. */
  readonly workdir?: string;
  /** Host paths visible read-only at the same path, such as a checkout to read. */
  readonly readOnly?: readonly string[];
  /** Further variables; the sandbox's own (`PATH`, `HOME`, proxy and connection) cannot be set. */
  readonly env?: Readonly<Record<string, string>>;
  /** Written to the task's stdin, which then ends. Without it stdin ends at once. */
  readonly stdin?: string | Uint8Array;
  readonly limits?: Partial<SandboxLimits>;
  /** Aborting stops the sandbox. */
  readonly signal?: AbortSignal;
}

export interface SandboxResult {
  readonly runId: string;
  /** The task's exit status; 125 when the launcher refused, 1 when bubblewrap did. */
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Stopped at the wall-time limit. */
  readonly timedOut: boolean;
  /** Stopped because stdout or stderr passed the output limit; what was kept is returned. */
  readonly truncated: boolean;
  /** Stopped by the caller. */
  readonly cancelled: boolean;
}

/** A started run. */
export interface SandboxRun {
  readonly runId: string;
  /** Revoke the run's token now; the sandbox keeps running, and its next call is refused. */
  revoke(): void;
  /** Stop the sandbox. */
  cancel(): void;
  readonly done: Promise<SandboxResult>;
}

export interface ExecutionHost {
  /** Never throws: why `sandbox` cannot run here, or that it can. */
  availability(sandbox: string): ProcessAvailability;
  start(task: SandboxTask): Promise<SandboxRun>;
  /** `start`, then its result. */
  run(task: SandboxTask): Promise<SandboxResult>;
}

export interface ExecutionHostOptions {
  /** Tools a task may name, as absolute host paths by name. Nothing else is mounted. */
  readonly tools: Readonly<Record<string, string>>;
  /** The Bun executable that runs the launcher inside; this process's runtime by default. */
  readonly runtime?: string;
}

/** What a run needs from the opened plugin. */
export interface HostSide {
  readonly ports: HostPorts;
  readonly broker: Broker;
  /** The host's loopback origin, once it listens. */
  readonly origin: () => string | undefined;
  /** Declared sandbox processes and whether each declares network destinations. */
  readonly sandboxes: ReadonlyMap<string, { readonly network: boolean }>;
  readonly now: () => number;
}

const reserved =
  /^(?:PATH|HOME|TMPDIR|LANG|AGENT_NATIVE_.*|(?:HTTPS?|ALL|NO)_PROXY|(?:https?|all|no)_proxy)$/;
const variable = /^[A-Za-z_][A-Za-z0-9_]*$/;
const no = (reason: string) => ({ available: false, reason }) as const;

/** The loopback port the host API listens on, or why the sandbox cannot reach it. */
function apiPort(origin: string | undefined): number | string {
  if (!origin) return 'Sandboxes run only under a serving host, once it listens';
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
    return 'Sandboxes reach the host only through a loopback HTTP listener';
  return Number(url.port || 80);
}

function availability(host: HostSide, sandbox: string): ProcessAvailability {
  if (process.platform !== 'linux')
    return no(`Sandboxes need Linux bubblewrap; ${process.platform} has no backend yet`);
  if (!seccompArch()) return no(`No seccomp filter is built for ${process.arch}`);
  if (!host.sandboxes.has(sandbox))
    return no(`Sandbox ${sandbox} is not declared by an executionSandbox component`);
  const port = apiPort(host.origin());
  if (typeof port === 'string') return no(port);
  return host.ports.processes.availability(sandbox);
}

async function hostEntry(path: string): Promise<HostEntry> {
  const stat = await lstat(path).catch(() => undefined);
  if (!stat) return { kind: 'missing' };
  if (stat.isSymbolicLink()) return { kind: 'symlink', target: await readlink(path) };
  return stat.isDirectory() ? { kind: 'directory' } : { kind: 'file' };
}

function checkTask(task: SandboxTask, options: ExecutionHostOptions) {
  const tool = options.tools[task.command[0]];
  if (!tool || !Object.hasOwn(options.tools, task.command[0]))
    throw new ApplicationError('INVALID_INPUT', `Tool ${task.command[0]} is not declared`);
  for (const path of [...(task.readOnly ?? []), ...(task.workdir ? [task.workdir] : [])])
    if (!isAbsolute(path)) throw new ApplicationError('INVALID_INPUT', `${path} is not absolute`);
  for (const name of Object.keys(task.env ?? {}))
    if (!variable.test(name) || reserved.test(name))
      throw new ApplicationError('INVALID_INPUT', `Variable ${name} cannot be set in a sandbox`);
  return tool;
}

/** The proxy variables and port for a sandbox that declares destinations. */
function egressOf(host: HostSide, sandbox: string) {
  if (!host.sandboxes.get(sandbox)?.network) return undefined;
  // Loopback inside the sandbox reaches only the relays, so the API is never sent to the proxy.
  const env: Record<string, string> = {
    ...childEnvironment(host.ports.network, sandbox),
    NO_PROXY: '127.0.0.1,localhost',
  };
  env.no_proxy = env.NO_PROXY!;
  const port = Number(new URL(env.HTTPS_PROXY!).port);
  return { env, port };
}

async function record(ports: HostPorts, entry: AuditRecord, required: boolean) {
  try {
    await ports.eventLog?.append([entry]);
  } catch (error) {
    if (required && ports.eventLog?.mode.egress === 'required') throw error;
  }
}

/** Collect a stream up to `limit` bytes; `over` is called once when it passes the limit. */
function collect(stream: NodeJS.ReadableStream, limit: number, over: () => void) {
  const chunks: Buffer[] = [];
  let size = 0;
  stream.on('data', (chunk: Buffer) => {
    if (size >= limit) return;
    const room = limit - size;
    chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
    size += Math.min(chunk.length, room);
    if (chunk.length > room) over();
  });
  return () => Buffer.concat(chunks).toString('utf8');
}

/**
 * Run tasks in bubblewrap sandboxes, through the process port:
 *
 * 1. Check the task: a declared tool, absolute paths, no reserved variables.
 * 2. Issue the run's token (the broker) and start the relays to the host API and, for a sandbox
 *    that declares destinations, the egress proxy.
 * 3. Record `sandbox.started`; a required audit log that cannot record it refuses the run.
 * 4. Start the declared sandbox process with the layout, the seccomp filter, the launcher, its
 *    launch file and the connection file on inherited descriptors.
 * 5. Enforce wall time and output size, then revoke the token, close the relays, remove the run
 *    directory and record `sandbox.exited`, whatever the outcome.
 */
export function createExecutionHost(
  host: HostSide,
  options: ExecutionHostOptions,
): ExecutionHost & { stopAll(): void } {
  const runtime = options.runtime ?? process.execPath;
  const running = new Set<SandboxRun>();

  async function start(task: SandboxTask): Promise<SandboxRun> {
    const status = availability(host, task.sandbox);
    if (!status.available) throw new ApplicationError('UNAVAILABLE', status.reason);
    const tool = checkTask(task, options);
    const limits = resolveLimits(task.limits);
    const port = apiPort(host.origin()) as number;
    const runId = task.context.runId ?? task.context.grant?.runId ?? `sandbox-${randomUUID()}`;
    const issued = host.broker.issue({ ...task.context, runId }, host.now() + limits.wallMs);
    const actor = {
      principalId: issued.context.principalId,
      workspaceId: issued.context.workspaceId,
      runId,
    };
    const directory = await mkdtemp(join(tmpdir(), 'agent-native-sandbox-'));
    const relays: Relay[] = [];
    const cleanup = async () => {
      host.broker.revoke(issued.token);
      await Promise.all(relays.map((relay) => relay.close()));
      await rm(directory, { recursive: true, force: true });
    };
    let spawned: SpawnedProcess;
    try {
      const sockets = join(directory, 'sock');
      await mkdir(sockets, { mode: 0o700 });
      const egress = egressOf(host, task.sandbox);
      relays.push(await startRelay(join(sockets, 'api.sock'), port));
      if (egress) relays.push(await startRelay(join(sockets, 'egress.sock'), egress.port));
      const tools = Object.values(options.tools);
      const system = new Map(
        await Promise.all(systemPaths.map(async (path) => [path, await hostEntry(path)] as const)),
      );
      const env = {
        ...task.env,
        PATH: toolPath(tools),
        HOME: '/tmp',
        TMPDIR: '/tmp',
        LANG: 'C.UTF-8',
        AGENT_NATIVE_CONNECTION: sandboxPaths.connection,
        ...egress?.env,
      };
      const args = bwrapArguments({
        runtime,
        tools,
        readOnly: task.readOnly ?? [],
        ...(task.workdir ? { workdir: task.workdir } : {}),
        sockets,
        env,
        system,
      });
      const launch = {
        relays: [
          { port, socket: `${sandboxPaths.sockets}/api.sock` },
          ...(egress ? [{ port: egress.port, socket: `${sandboxPaths.sockets}/egress.sock` }] : []),
        ],
        limits: kernelLimits(limits),
        command: [tool, ...task.command.slice(1)],
      };
      const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
      const launcher = await readFile(new URL('../sandbox/launcher.ts', import.meta.url));
      await record(
        host.ports,
        {
          kind: 'sandbox.started',
          outcome: 'allowed',
          actor,
          data: { sandbox: task.sandbox, tool: task.command[0], network: !!egress },
        },
        true,
      );
      spawned = await bunProcesses(host.ports.processes)(task.sandbox, {
        args: bwrapCommand(runtime),
        inputs: [
          encodeArguments(args),
          seccompFilter(seccompArch()!),
          launcher,
          encode(launch),
          encode({ endpoint: `http://127.0.0.1:${port}/`, token: issued.token }),
        ],
      });
    } catch (error) {
      await cleanup();
      throw error;
    }

    const { child } = spawned;
    let timedOut = false;
    let truncated = false;
    let cancelled = false;
    const stop = () => spawned.terminate();
    const over = () => {
      truncated = true;
      stop();
    };
    const stdout = collect(child.stdout, limits.outputBytes, over);
    const stderr = collect(child.stderr, limits.outputBytes, over);
    child.stdin.on('error', () => {});
    child.stdin.end(task.stdin ?? '');
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, limits.wallMs);
    const cancel = () => {
      cancelled = true;
      stop();
    };
    task.signal?.addEventListener('abort', cancel, { once: true });
    if (task.signal?.aborted) cancel();

    // Output is complete once the sandbox exited and both streams ended.
    const ended = (stream: NodeJS.ReadableStream) =>
      new Promise<void>((resolve) => stream.once('end', resolve).once('close', resolve));
    const exited = new Promise<[number | null, NodeJS.Signals | null]>((resolve) =>
      child.once('exit', (code, signal) => resolve([code, signal])),
    );
    const done = Promise.all([exited, ended(child.stdout), ended(child.stderr)])
      .then(([[exitCode, signal]]): SandboxResult => {
        clearTimeout(timer);
        task.signal?.removeEventListener('abort', cancel);
        return {
          runId,
          exitCode,
          signal,
          stdout: stdout(),
          stderr: stderr(),
          timedOut,
          truncated,
          cancelled,
        };
      })
      .then(async (result) => {
        running.delete(run);
        await cleanup();
        await record(
          host.ports,
          {
            kind: 'sandbox.exited',
            outcome: 'info',
            actor,
            data: {
              sandbox: task.sandbox,
              code: result.exitCode,
              signal: result.signal,
              timedOut,
              truncated,
              cancelled,
            },
          },
          false,
        );
        return result;
      });
    const run: SandboxRun = {
      runId,
      revoke: () => host.broker.revoke(issued.token),
      cancel,
      done,
    };
    running.add(run);
    return run;
  }

  return {
    availability: (sandbox) => availability(host, sandbox),
    start,
    run: async (task) => (await start(task)).done,
    stopAll() {
      for (const run of running) run.cancel();
    },
  };
}

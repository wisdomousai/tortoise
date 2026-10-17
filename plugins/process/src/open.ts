import { ApplicationError, type AuditRecord } from '@agent-native/contracts';
import type { ResolvedProcess } from '@agent-native/egress';
import type {
  BunProcessPort,
  HostPorts,
  PluginInstance,
  PluginOpenContext,
  ProcessSpawnOptions,
  SpawnedProcess,
} from '@agent-native/host/plugin';
import { siteServiceOf } from '@agent-native/site/open';
import { availability, bindingFor, environment, type Decision } from './decide';
import { baseEnvironment, digestFile, startChild, terminateTree } from './spawn';

type Child = Awaited<ReturnType<typeof startChild>>;

/** How long a tree has to stop after SIGTERM before it is killed. */
const graceMs = 2_000;

/** Every start, refusal and exit as an audit record; a required log refuses the start it cannot record. */
async function record(ports: HostPorts, record: AuditRecord) {
  const log = ports.eventLog;
  if (!log) return;
  try {
    await log.append([record]);
  } catch (error) {
    if (log.mode.egress === 'required' && record.kind === 'child.started') throw error;
  }
}

/** Refuse a binding whose executable no longer matches its pin, before it runs. */
async function checkPin(binding: ResolvedProcess) {
  if (!binding.sha256) return;
  const digest = await digestFile(binding.executable).catch(() => undefined);
  if (digest === undefined)
    throw new ApplicationError(
      'UNAVAILABLE',
      `Executable for process ${binding.process.id} is missing`,
    );
  if (digest !== binding.sha256)
    throw new ApplicationError(
      'FORBIDDEN',
      `Executable for process ${binding.process.id} does not match its pinned digest`,
    );
}

/** One child's lifetime: tracked while it runs, stopped by `signal` or close, recorded on exit. */
function track(
  children: Set<SpawnedProcess>,
  ports: HostPorts,
  processId: string,
  child: Child,
  signal: AbortSignal | undefined,
): SpawnedProcess {
  let stopping = false;
  const handle: SpawnedProcess = {
    child,
    terminate() {
      if (stopping) return;
      stopping = true;
      terminateTree(child, false);
      setTimeout(() => terminateTree(child, true), graceMs).unref();
    },
  };
  const stop = () => handle.terminate();
  signal?.addEventListener('abort', stop, { once: true });
  children.add(handle);
  child.once('exit', (code, exitSignal) => {
    children.delete(handle);
    signal?.removeEventListener('abort', stop);
    void record(ports, {
      kind: 'child.exited',
      outcome: 'info',
      data: { process: processId, code, signal: exitSignal },
    });
  });
  return handle;
}

/**
 * The process port over the site policy's bindings:
 *
 * 1. Decide availability from the declaration, the policy and the platform (`decide.ts`).
 * 2. Before each start, check the executable's pin, then build the child's environment.
 * 3. Record the start; a required audit log that cannot record it stops the child again.
 * 4. Track the child until it exits; `close` stops every tree still running.
 *
 * Refusals reject with UNAVAILABLE (cannot run here) or FORBIDDEN (pin mismatch) and are
 * recorded as `child.refused` with that code.
 */
export async function openProcesses(context: PluginOpenContext): Promise<PluginInstance> {
  const { policy } = siteServiceOf(context.services);
  const decision: Decision = { policy, context };
  const ports = context.ports;
  const children = new Set<SpawnedProcess>();
  let closed = false;

  async function start(processId: string, options: ProcessSpawnOptions = {}) {
    if (closed) throw new ApplicationError('UNAVAILABLE', 'The process plugin is closed');
    options.signal?.throwIfAborted();
    const binding = bindingFor(decision, processId);
    await checkPin(binding);
    const env = await environment(decision, ports, binding, baseEnvironment());
    const child = await startChild(binding, options.args ?? [], env).catch(() => {
      throw new ApplicationError('UNAVAILABLE', `Process ${processId} could not be started`);
    });
    const handle = track(children, ports, processId, child, options.signal);
    try {
      await record(ports, {
        kind: 'child.started',
        outcome: 'allowed',
        data: { process: processId, pid: child.pid ?? null, pinned: !!binding.sha256 },
      });
    } catch (error) {
      handle.terminate();
      throw error;
    }
    return handle;
  }

  const processes: BunProcessPort = {
    availability(processId) {
      if (closed) return { available: false, reason: 'The process plugin is closed' };
      const answer = availability(decision, processId);
      return answer.available ? { available: true } : answer;
    },
    async spawn(processId, options) {
      try {
        return await start(processId, options);
      } catch (error) {
        const code = error instanceof ApplicationError ? error.code : 'INTERNAL';
        await record(ports, {
          kind: 'child.refused',
          outcome: 'denied',
          reason: code,
          data: { process: processId },
        });
        throw error;
      }
    },
  };

  return {
    ports: { processes },
    describe: () => ({ bound: [...policy.processes.keys()].sort() }),
    async close() {
      closed = true;
      for (const handle of [...children]) handle.terminate();
    },
  };
}

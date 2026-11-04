import { localHarness } from '@tortoise/agents/local';
import {
  activates,
  defineModelEntry,
  entryIdentity,
  type ModelActivation,
  type ModelEntry,
} from '@tortoise/agents/models';
import { LOCAL_INFERENCE_DESTINATION } from '@tortoise/agents/requirements';
import type { Harness, ModelIdentity } from '@tortoise/agents/types';
import type { AuditRecord } from '@tortoise/contracts';
import {
  bunProcesses,
  defineHostPlugin,
  type HostPorts,
  type PluginOpenContext,
  type SpawnedProcess,
} from '@tortoise/host/plugin';
import { serverArguments, type ModelFiles } from './arguments';
import type { ModelRuntime } from './contracts';
import { measure } from './measure';
import { modelServerPluginManifest } from './plugin-manifest';

export interface ModelServerOptions {
  /** The process ID of the `modelServer` component. */
  readonly process: string;
  readonly runtime: ModelRuntime;
  readonly entry: ModelEntry;
  /** Absolute paths of the weights on this host, hashed before every start. */
  readonly files: ModelFiles;
  /**
   * The gate's result for this entry (`gateModel` in `@tortoise/testing`). A fine-tune
   * never serves without a passing one for its exact digests; a base model needs one only with
   * `requireActivation`.
   */
  readonly activation?: ModelActivation;
  readonly requireActivation?: boolean;
  /**
   * Serve the measured files without an activation, so the gate can judge them: only
   * `evaluationHarness` reaches the server, and `harness` stays unavailable. Never for production.
   */
  readonly evaluation?: boolean;
  /** How long the server may take to list the model after it starts; five minutes by default. */
  readonly readyTimeoutMs?: number;
  readonly pollMs?: number;
  readonly maxSteps?: number;
  readonly maxOutputTokens?: number;
}

export type ModelServerStatus =
  | { readonly state: 'stopped'; readonly reason: string }
  | { readonly state: 'measuring' | 'starting' }
  | { readonly state: 'ready'; readonly model: ModelIdentity }
  | { readonly state: 'refused' | 'exited'; readonly reason: string };

export interface ModelServerService {
  status(): ModelServerStatus;
  /** The harness agents run on; unavailable, with the reason, until the server is ready. */
  readonly harness: Harness;
}

const EVALUATION_ONLY =
  'The model server runs for evaluation only; agents reach it through its gate, not here';

async function record(ports: HostPorts, entry: AuditRecord, required: boolean) {
  try {
    await ports.eventLog?.append([entry]);
  } catch (error) {
    if (required && ports.eventLog?.mode.network === 'required') throw error;
  }
}

const reasonOf = (status: ModelServerStatus) =>
  'reason' in status ? status.reason : `Model server is ${status.state}`;

/**
 * The model server plugin. On a serving host it hashes the configured weights, refuses to start
 * when a digest differs from the entry or a fine-tune has no passing activation, and otherwise
 * starts the declared server process through the process port and waits until it lists the
 * entry. The harness it returns reaches the server only through the `local-inference`
 * destination and records the measured digests on every run.
 *
 * Trust boundary: the deployment chooses the files, the entry and the activation; the plugin
 * proves only that the files are the ones the entry names. The server is a child of the host and
 * is trusted to serve what it loaded; the site policy pins its executable.
 */
export function createModelServer(options: ModelServerOptions) {
  const entry = defineModelEntry(options.entry);
  serverArguments(options.runtime, entry, options.files);
  let status: ModelServerStatus = {
    state: 'stopped',
    reason: 'The model server starts only in a serving host',
  };
  let ports: HostPorts | undefined;
  let spawned: SpawnedProcess | undefined;
  let stopping = false;
  const served = (evaluation: boolean) =>
    localHarness({
      model: entry.id,
      entry,
      verified: true,
      client: () => ports!.network.client(LOCAL_INFERENCE_DESTINATION),
      ready: () =>
        evaluation !== !!options.evaluation
          ? {
              available: false,
              reason: evaluation ? 'Not started for evaluation' : EVALUATION_ONLY,
            }
          : status.state === 'ready'
            ? { available: true }
            : { available: false, reason: reasonOf(status) },
      ...(options.maxSteps ? { maxSteps: options.maxSteps } : {}),
      ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
    });
  const harness = served(false);
  const evaluationHarness = served(true);
  const data = () => ({
    entry: entry.id,
    process: options.process,
    runtime: options.runtime,
    base: entry.base.digest,
    ...(entry.adapter ? { adapter: entry.adapter.digest } : {}),
    ...(entry.adapter?.dataset ? { dataset: entry.adapter.dataset } : {}),
    ...(options.evaluation ? { evaluation: true } : {}),
  });

  async function refuse(host: HostPorts, reason: string, code: string) {
    status = { state: 'refused', reason };
    await record(
      host,
      { kind: 'model.refused', outcome: 'denied', reason: code, data: data() },
      false,
    );
  }

  /** Each file against the digest its entry names; the first difference refuses the start. */
  async function verify(host: HostPorts): Promise<boolean> {
    const checks: [string, string, string | undefined][] = [
      ['base weights', options.files.base, entry.base.digest],
      ...(entry.adapter
        ? [['adapter', options.files.adapter!, entry.adapter.digest] as [string, string, string]]
        : []),
    ];
    for (const [label, path, declared] of checks) {
      let measured: string;
      try {
        measured = await measure(path);
      } catch (error) {
        await refuse(
          host,
          `Cannot read the ${label} at ${path}: ${(error as Error).message}`,
          'UNREADABLE',
        );
        return false;
      }
      if (measured !== declared) {
        await refuse(
          host,
          `The ${label} at ${path} measure ${measured}, but model ${entry.id} names ${declared}`,
          'DIGEST_MISMATCH',
        );
        return false;
      }
    }
    if (
      !options.evaluation &&
      (entry.adapter || options.requireActivation) &&
      !activates(options.activation, entry)
    ) {
      await refuse(
        host,
        `Model ${entry.id} has no passing activation for its digests; run its gate first`,
        'NOT_ACTIVATED',
      );
      return false;
    }
    return true;
  }

  async function ready(host: HostPorts, child: SpawnedProcess) {
    const deadline = Date.now() + (options.readyTimeoutMs ?? 300_000);
    while (Date.now() < deadline && status.state === 'starting') {
      try {
        const response = await host.network
          .client(LOCAL_INFERENCE_DESTINATION)
          .fetch('v1/models', { headers: { accept: 'application/json' } });
        const body = response.ok ? ((await response.json()) as { data?: { id?: unknown }[] }) : {};
        if (body.data?.some((model) => model.id === entry.id)) {
          status = { state: 'ready', model: entryIdentity(entry, true) };
          return;
        }
      } catch {
        // Not listening yet.
      }
      await Bun.sleep(options.pollMs ?? 500);
    }
    if (status.state !== 'starting') return;
    child.terminate();
    await refuse(host, `The model server did not list ${entry.id} in time`, 'NOT_READY');
  }

  async function launch(host: HostPorts) {
    status = { state: 'measuring' };
    if (!(await verify(host)) || stopping) return;
    status = { state: 'starting' };
    try {
      await record(host, { kind: 'model.started', outcome: 'allowed', data: data() }, true);
      spawned = await bunProcesses(host.processes)(options.process, {
        args: serverArguments(options.runtime, entry, options.files),
      });
    } catch (error) {
      await refuse(
        host,
        `The model server could not start: ${(error as Error).message}`,
        'UNAVAILABLE',
      );
      return;
    }
    const child = spawned;
    // Drain the pipes so a chatty server never blocks; keep the end of stderr for the reason.
    let tail = '';
    child.child.stdout.resume();
    child.child.stderr.on('data', (chunk: Buffer) => {
      tail = (tail + chunk.toString('utf8')).slice(-2_000);
    });
    child.child.once('exit', (code, signal) => {
      if (stopping) return;
      const reason = `The model server exited (${signal ?? `code ${code}`})${tail ? `: ${tail.trim().split('\n').at(-1)}` : ''}`;
      status = { state: 'exited', reason };
      void record(host, { kind: 'model.exited', outcome: 'failed', data: data() }, false);
    });
    await ready(host, child);
  }

  const plugin = defineHostPlugin({
    manifest: modelServerPluginManifest,
    requires: ['process', 'network'],
    async open(context: PluginOpenContext) {
      const declared = context.catalog.requirements.processes.find(
        (process) => process.id === options.process,
      );
      if (declared?.executable !== options.runtime)
        throw new Error(
          `Model server ${options.process} is not a declared ${options.runtime} process; add modelServer({ id: '${options.process}', runtime: '${options.runtime}' }) to the manifest`,
        );
      if (
        !context.catalog.requirements.network.some(
          (destination) => destination.id === LOCAL_INFERENCE_DESTINATION,
        )
      )
        throw new Error('The model server needs localInferenceComponent in the manifest');
      const service: ModelServerService = { status: () => status, harness };
      const stop = async () => {
        stopping = true;
        spawned?.terminate();
      };
      return {
        service,
        // The host's run route may start agent runs on it; the entry's agents still bind.
        harnesses: [harness],
        async start(started) {
          // Ports are complete only once every plugin opened, so they are taken here.
          ports = started.ports;
          void launch(started.ports);
          return [{ stop }];
        },
        describe: () => ({ entry: entry.id, runtime: options.runtime, state: status.state }),
        close: stop,
      };
    },
  });
  return { plugin, harness, evaluationHarness, status: () => status };
}

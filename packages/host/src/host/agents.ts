import type { Sessions } from '@tortoise/adapters/http';
import type { UiSessionStore } from '@tortoise/adapters/ui-sessions';
import { DeterministicHarness } from '@tortoise/agents/deterministic';
import type { Harness } from '@tortoise/agents/types';
import { createRunSupervisor, runAuditRecord } from '@tortoise/agents/supervisor';
import { childEnvironment } from '../plugin';
import { createProviderAccess } from '../providers';
import { createAgentTools } from './agent-tools';
import type { Instance } from './instance';
import type { CleanupStack, StartHostOptions, WorkspaceOwnership } from './options';

/** Provider access and the run supervisor, whose tools execute as the run's captured context. */
export async function startAgents(
  instance: Instance,
  options: StartHostOptions,
  ownership: WorkspaceOwnership,
  host: {
    readonly sessions: Sessions;
    readonly origin: () => string;
    readonly uiSessions?: UiSessionStore;
  },
  cleanup: CleanupStack,
) {
  const { ports, application } = instance;
  const providers = await createProviderAccess({
    workspacePath: ownership.canonicalPath,
    origin: host.origin,
    sessions: (token) => host.sessions.get(token),
    runtimeManifest: options.runtimeManifest,
    // Provider SDKs reach only the declared OpenAI destinations; provider CLIs get an environment
    // that confines them to the destinations their process declaration lists. Both go through
    // the network port, so without a plugin that provides it neither reaches anything.
    fetch: ports.network.routedFetch(['openai-auth', 'openai-api']),
    childEnvironment: (processId) => childEnvironment(ports.network, processId),
  });
  cleanup.push(() => providers.close());
  // Harnesses that need no provider selection: the embedding process's and the plugins', such as
  // a model server's. An agent run started without a harness takes the first one that fits.
  const harnesses = [...(options.harnesses ?? []), ...pluginHarnesses(instance)];
  const supervisor: ReturnType<typeof createRunSupervisor> = createRunSupervisor({
    harnesses: [new DeterministicHarness(), ...providers.harnesses, ...harnesses],
    store: instance.runStore,
    tools: createAgentTools(application, (id) => supervisor.get(id), host.uiSessions),
    // Run starts and ends go to the audit log after the fact. A log that cannot write never
    // stops a run: the audit mode's fail-closed settings cover commands, queries and network connections.
    ...(ports.eventLog
      ? {
          onRun: (run, change) =>
            void ports.eventLog!.append([runAuditRecord(run, change)]).catch(() => undefined),
        }
      : {}),
  });
  await supervisor.recoverInterrupted();
  return { providers, supervisor, harnesses };
}

/** The harnesses plugins offer, each checked for the members a supervisor calls. */
function pluginHarnesses(instance: Instance): Harness[] {
  return instance.plugins.harnesses().map((candidate) => {
    const harness = candidate as Partial<Harness>;
    if (
      typeof harness.id !== 'string' ||
      typeof harness.run !== 'function' ||
      typeof harness.availability !== 'function'
    )
      throw new Error('A plugin offered a harness without an id, run and availability');
    return harness as Harness;
  });
}

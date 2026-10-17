import type { Sessions } from '@agent-native/adapters/http';
import { DeterministicHarness } from '@agent-native/agents/deterministic';
import { createRunSupervisor, runAuditRecord } from '@agent-native/agents/supervisor';
import { childEnvironment } from '../plugin';
import { createProviderAccess } from '../providers';
import { createAgentTools } from './agent-tools';
import type { Authority } from './authority';
import type { CleanupStack, StartHostOptions, WorkspaceOwnership } from './options';

/** Provider access and the run supervisor, whose tools execute as the run's captured context. */
export async function startAgents(
  authority: Authority,
  options: StartHostOptions,
  ownership: WorkspaceOwnership,
  host: { readonly sessions: Sessions; readonly origin: () => string },
  cleanup: CleanupStack,
) {
  const { ports, application } = authority;
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
  const supervisor: ReturnType<typeof createRunSupervisor> = createRunSupervisor({
    harnesses: [new DeterministicHarness(), ...providers.harnesses, ...(options.harnesses ?? [])],
    store: authority.runStore,
    tools: createAgentTools(application, (id) => supervisor.get(id)),
    // Run starts and ends go to the audit log after the fact. A log that cannot write never
    // stops a run: the audit mode's fail-closed settings cover commands, queries and egress.
    ...(ports.eventLog
      ? {
          onRun: (run, change) =>
            void ports.eventLog!.append([runAuditRecord(run, change)]).catch(() => undefined),
        }
      : {}),
  });
  await supervisor.recoverInterrupted();
  return { providers, supervisor };
}

import type { Sessions } from '@agent-native/adapters/http';
import { DeterministicHarness } from '@agent-native/agents/deterministic';
import { createRunSupervisor } from '@agent-native/agents/supervisor';
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
    childEnvironment: (processId) => ports.network.childEnvironment(processId),
  });
  cleanup.push(() => providers.close());
  const supervisor: ReturnType<typeof createRunSupervisor> = createRunSupervisor({
    harnesses: [new DeterministicHarness(), ...providers.harnesses, ...(options.harnesses ?? [])],
    store: authority.runStore,
    tools: createAgentTools(application, (id) => supervisor.get(id)),
  });
  await supervisor.recoverInterrupted();
  return { providers, supervisor };
}

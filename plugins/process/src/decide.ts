import { ApplicationError } from '@agent-native/contracts';
import type { ResolvedPolicy, ResolvedProcess } from '@agent-native/site/policy';
import type { HostPorts, PluginOpenContext, ProcessAvailability } from '@agent-native/host/plugin';

/** What deciding a start needs: the resolved policy and the opening context. */
export interface Decision {
  readonly policy: ResolvedPolicy;
  readonly context: PluginOpenContext;
}

const no = (reason: string) =>
  ({ available: false, reason }) as const satisfies ProcessAvailability;

/**
 * Whether `processId` can start here, in the order a reviewer would check it: declared, not
 * disabled, bound, its secrets storable, and its network confinable. The last applies only to a
 * process that declares destinations: the confining proxy runs only under a serving host.
 */
export function availability({ policy, context }: Decision, processId: string) {
  const declared = context.catalog.requirements.processes.find((item) => item.id === processId);
  if (!declared) return no(`Process ${processId} is not declared by any module or component`);
  if (policy.disabledProcesses.has(processId))
    return no(`Process ${processId} is disabled by the site policy`);
  const binding = policy.processes.get(processId);
  if (!binding) return no(`Process ${processId} is not bound by the site policy`);
  if (declared.secrets?.length && !context.secrets)
    return no(`Process ${processId} needs secrets, and this platform keeps none`);
  if (declared.network?.length && !context.serving)
    return no(
      `Process ${processId} reaches the network, which children may only under a serving host`,
    );
  return { available: true, binding } as const;
}

/** The started binding, or UNAVAILABLE with the reason `availability` gave. */
export function bindingFor(decision: Decision, processId: string): ResolvedProcess {
  const answer = availability(decision, processId);
  if (!answer.available) throw new ApplicationError('UNAVAILABLE', answer.reason);
  return answer.binding;
}

/**
 * The child's whole environment: the inherited basics, the binding's configuration, the egress
 * proxy for its declared destinations, then its declared secrets. Later sources win, and the
 * policy cannot set the proxy or secret names (`resolveProcesses` refuses that), so the order
 * only matters for the basics. A missing secret is UNAVAILABLE, naming the secret, not its value.
 */
export async function environment(
  { context }: Decision,
  ports: HostPorts,
  binding: ResolvedProcess,
  base: Record<string, string>,
): Promise<Record<string, string>> {
  const id = binding.process.id;
  const env: Record<string, string> = { ...base, ...binding.env };
  if (binding.process.network?.length) {
    if (!ports.network.childEnvironment)
      throw new ApplicationError('UNAVAILABLE', `No network port can confine process ${id}`);
    Object.assign(env, ports.network.childEnvironment(id));
  }
  for (const name of binding.process.secrets ?? []) {
    const value = await context.secrets!.get(`${id}.${name}`);
    if (value === undefined)
      throw new ApplicationError('UNAVAILABLE', `Secret ${name} for process ${id} is not set`);
    env[name] = value;
  }
  return env;
}

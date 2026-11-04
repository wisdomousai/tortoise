import { ApplicationError, type AuditMode, type EventLogPort } from '@tortoise/contracts';
import { createNetworkGuard, type NetworkGuard } from './guard';
import { startNetworkProxy, type NetworkProxy } from './proxy';
import type { HostPorts, PluginInstance, PluginOpenContext } from '@tortoise/host/plugin';
import { deploymentServiceOf } from '@tortoise/deployment/open';
import { policyIngress } from './ingress';

/** What the network plugin exposes to later plugins as `services.network`. */
export interface NetworkService {
  readonly guard: NetworkGuard;
  /** The loopback CONNECT proxy for declared children; serving hosts only. */
  readonly proxy?: NetworkProxy;
}

const unrecorded: AuditMode = Object.freeze({
  commands: 'best-effort',
  queries: 'best-effort',
  network: 'best-effort',
});

/**
 * The composed event log, read on each guard decision. It comes from whichever plugin provides
 * the port, possibly one opened after this one, so the guard records into it without either
 * plugin importing the other. Without a provider, decisions go unrecorded and never block.
 */
function composedEventLog(ports: HostPorts): EventLogPort {
  return {
    get mode() {
      return ports.eventLog?.mode ?? unrecorded;
    },
    append: async (records) => (ports.eventLog ? ports.eventLog.append(records) : []),
  };
}

/** Every outbound connection through the guard; children only through the CONNECT proxy. */
function networkPort(guard: NetworkGuard, proxy: NetworkProxy | undefined): HostPorts['network'] {
  return {
    client: (id) => guard.client(id),
    routedFetch: (ids) => guard.routedFetch(ids),
    socket: (id, handler) => guard.socket(id, handler),
    childEnvironment(processId) {
      if (!proxy)
        throw new ApplicationError('UNAVAILABLE', 'Child processes run only under a serving host');
      return proxy.childEnvironment(processId);
    },
  };
}

/**
 * Enforce the deployment policy's bindings:
 *
 * 1. Create the network guard over the policy the deployment plugin resolved, recording into the
 *    composed event log in that log's network mode.
 * 2. In a serving host, start the loopback CONNECT proxy that declared child processes (provider
 *    CLIs) must use.
 * 3. Provide the network port, and the ingress port when the policy selects a TLS or mutual TLS listener.
 *
 * Throws when the deployment plugin is not composed or the proxy cannot start.
 */
export async function openNetwork(context: PluginOpenContext): Promise<PluginInstance> {
  const { policy, requirements } = deploymentServiceOf(context.services);
  const guard = createNetworkGuard({
    policy,
    requirements,
    eventLog: composedEventLog(context.ports),
  });
  const proxy = context.serving ? await startNetworkProxy(guard) : undefined;
  const ingress = policyIngress(policy);
  const service: NetworkService = { guard, ...(proxy ? { proxy } : {}) };
  return {
    ports: { network: networkPort(guard, proxy), ...(ingress ? { ingress } : {}) },
    service,
    describe: () => ({ mode: policy.mode, ingress: policy.policy.ingress.listen }),
    async close() {
      await proxy?.close().catch(() => undefined);
    },
  };
}

/**
 * The network plugin's service among a host's plugin services, typed. Throws when the
 * application does not compose the network plugin.
 */
export function networkServiceOf(services: Readonly<Record<string, unknown>>): NetworkService {
  const service = services.network as NetworkService | undefined;
  if (!service) throw new Error('This application does not compose the network plugin');
  return service;
}

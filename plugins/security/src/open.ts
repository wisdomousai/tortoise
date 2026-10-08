import { join } from 'node:path';
import {
  ApplicationError,
  type AuditEvent,
  type AuditRecord,
  type CatalogRequirements,
  type EventLogPort,
} from '@agent-native/contracts';
import {
  assertPolicyUsable,
  isolatedPolicy,
  loadSitePolicy,
  type Egress,
  type EgressProxy,
  type ResolvedPolicy,
} from '@agent-native/egress';
import {
  digest,
  readEvents,
  unresolvedCommands,
  type ChainHead,
  type ForwardingStats,
} from '@agent-native/event-log';
import type { HostPorts, PluginInstance, PluginOpenContext } from '@agent-native/host/plugin';
import { attestationRecords } from './attestation';
import { openAuditChannel } from './audit-channel';
import { digestExecutable } from './executable-digest';
import { assertIdentity } from './identity';
import { mtlsIngress } from './ingress';

/**
 * What the security plugin exposes to later plugins as `services.security`: the resolved policy
 * and read access to the log it writes. The assurance plugin builds its posture monitor on it.
 */
export interface SecurityService {
  readonly policy: ResolvedPolicy;
  readonly requirements: CatalogRequirements;
  readonly eventLog: EventLogPort;
  readonly egress: Egress;
  readonly proxy?: EgressProxy;
  readonly logDirectory: string;
  head(): ChainHead;
  forwarding(): ForwardingStats | undefined;
  readonly catalogDigest: string;
  executableDigest(): Promise<string>;
}

/** Command outcomes needed to find accepted commands left without one by a crash. */
const recoveryKinds = [
  'command.accepted',
  'command.committed',
  'command.replayed',
  'command.recovered',
  'command.aborted',
  'command.failed',
  'command.denied',
];

/** Every outbound connection through the guard; children only through the CONNECT proxy. */
function networkPort(egress: Egress, proxy: EgressProxy | undefined): HostPorts['network'] {
  return {
    client: (id) => egress.client(id),
    routedFetch: (ids) => egress.routedFetch(ids),
    socket: (id, handler) => egress.socket(id, handler),
    childEnvironment(processId) {
      if (!proxy)
        throw new ApplicationError('UNAVAILABLE', 'Child processes run only under a serving host');
      return proxy.childEnvironment(processId);
    },
  };
}

/**
 * The deployment's security posture, opened before anything serves or writes:
 *
 * 1. Resolve the site policy against the composed requirements and refuse to start on any error
 *    finding (profile floors included). No policy file means isolated.
 * 2. Open the audit log under its writer lock, in the policy's audit mode, and wrap it in an
 *    off-host forwarder when `audit.forwardTo` names a bound destination.
 * 3. Create the egress guard over that log; in a serving host, start the loopback CONNECT proxy
 *    that declared child processes (provider CLIs) must use.
 *
 * The host passes `ports.eventLog` to the runtime and `ports.network` to integrations and
 * providers. `ready` attests and resolves crash-orphaned commands before anything is served.
 * Throws on an unusable policy or a locked/unwritable log; everything opened so far is closed.
 */
export async function openSecurity(context: PluginOpenContext): Promise<PluginInstance> {
  const { catalog, manifest, settings } = context;
  const requirements = catalog.requirements;
  const sitePolicy = settings['site-policy'];
  const policy: ResolvedPolicy = sitePolicy
    ? await loadSitePolicy(sitePolicy, requirements)
    : isolatedPolicy(requirements);
  assertPolicyUsable(policy);
  const directory = settings['audit-log'] ?? join(context.workspacePath, 'audit');
  const channel = await openAuditChannel(policy, requirements, {
    directory,
    application: manifest.id,
    component: context.component,
    instance: context.instance,
    childProxy: context.serving,
  });
  const { log, forwardTo, sink, forwarder, eventLog, egress, proxy } = channel;
  const catalogDigest = digest(catalog);
  const service: SecurityService = {
    policy,
    requirements,
    eventLog,
    egress,
    ...(proxy ? { proxy } : {}),
    logDirectory: directory,
    head: () => log.head(),
    forwarding: () => forwarder?.stats(),
    catalogDigest,
    executableDigest: digestExecutable,
  };
  const ingress = mtlsIngress(policy);
  return {
    ports: {
      eventLog,
      network: networkPort(egress, proxy),
      ...(ingress ? { ingress } : {}),
      identity: {
        admit: (caller) => assertIdentity(policy, caller),
        localOwnerSessions: policy.policy.identity === 'local-owner',
      },
    },
    service,
    // Attest what is running, then resolve audit entries a crash left open. Both precede any
    // integration pass or request, so no new command reuses a cursor recovery compares against.
    async ready(application) {
      const executableDigest = await digestExecutable();
      const facts = { application: manifest.id, executableDigest, catalogDigest, forwardTo };
      await log.append(attestationRecords(policy, facts, { instance: context.instance }));
      await recover(directory, application);
    },
    describe: () => ({ profile: policy.profile, network: policy.mode, auditLog: directory }),
    // Stop the proxy, offer queued events to the collector, release the lock. The host closes
    // this plugin after every plugin opened later, so nothing audits into a closed log.
    async close() {
      await proxy?.close().catch(() => undefined);
      await forwarder?.flush().catch(() => undefined);
      sink?.close();
      await log.close();
    },
  };
}

/** Resolve `command.accepted` events left without an outcome by a crash. */
async function recover(
  directory: string,
  application: { recoverAudit(accepted: readonly AuditEvent[]): Promise<readonly AuditRecord[]> },
) {
  const pending = unresolvedCommands(await readEvents(directory, { kinds: recoveryKinds }));
  if (pending.length) await application.recoverAudit(pending);
}

/**
 * The security plugin's service among a host's plugin services, typed. Throws when the
 * application does not compose the security plugin, so a caller that needs the policy or the
 * log cannot silently run without them.
 */
export function securityServiceOf(services: Readonly<Record<string, unknown>>): SecurityService {
  const service = services.security as SecurityService | undefined;
  if (!service) throw new Error('This application does not compose the security plugin');
  return service;
}

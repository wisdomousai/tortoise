import { join } from 'node:path';
import type { AuditEvent, AuditRecord, EventLogPort } from '@agent-native/contracts';
import {
  digest,
  readEvents,
  unresolvedCommands,
  type ChainHead,
  type ForwardingStats,
} from '@agent-native/event-log';
import type { PluginInstance, PluginOpenContext } from '@agent-native/host/plugin';
import { siteServiceOf } from '@agent-native/site/open';
import { attestationRecords } from './attestation';
import { openAuditChannel } from './audit-channel';
import { digestExecutable } from './executable-digest';

/**
 * What the audit plugin exposes to later plugins as `services.audit`: read access to the log it
 * writes and the facts it attests. The compliance plugin builds its posture monitor on it. It
 * carries no credentials and no write access beyond the event-log port every caller shares.
 */
export interface AuditService {
  readonly eventLog: EventLogPort;
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

/**
 * Open the audit trail before anything serves or writes:
 *
 * 1. Open the log under its writer lock in the site policy's audit mode, wrapped in an off-host
 *    forwarder when `audit.forwardTo` names a bound destination.
 * 2. Provide it as the event-log port; the host passes it to the runtime, and the network
 *    plugin's guard records into it through the composed ports.
 *
 * `ready` then attests what is running and resolves commands a crash left open, before the
 * first request. Throws when the site plugin is not composed or the log is locked or
 * unwritable.
 */
export async function openAudit(context: PluginOpenContext): Promise<PluginInstance> {
  const { policy } = siteServiceOf(context.services);
  const directory = context.settings['audit-log'] ?? join(context.workspacePath, 'audit');
  const { log, forwardTo, sink, forwarder, eventLog } = await openAuditChannel(
    policy,
    () => context.ports.network,
    {
      directory,
      application: context.manifest.id,
      component: context.component,
      instance: context.instance,
    },
  );
  const catalogDigest = digest(context.catalog);
  const service: AuditService = {
    eventLog,
    logDirectory: directory,
    head: () => log.head(),
    forwarding: () => forwarder?.stats(),
    catalogDigest,
    executableDigest: digestExecutable,
  };
  return {
    ports: { eventLog },
    service,
    // Attest what is running, then resolve audit entries a crash left open. Both precede any
    // integration pass or request, so no new command reuses a cursor recovery compares against.
    async ready(application) {
      const executableDigest = await digestExecutable();
      const facts = {
        application: context.manifest.id,
        executableDigest,
        catalogDigest,
        forwardTo,
        ...(context.build ? { build: context.build } : {}),
      };
      await log.append(attestationRecords(policy, facts, { instance: context.instance }));
      await recover(directory, application);
    },
    describe: () => ({ log: directory, mode: policy.policy.audit.mode }),
    // Offer queued events to the collector, then release the lock. The host closes this plugin
    // after every plugin opened later, so nothing audits into a closed log; the network plugin,
    // opened earlier, still carries the final flush.
    async close() {
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
 * The audit plugin's service among a host's plugin services, typed. Throws when the application
 * does not compose the audit plugin, so a caller that needs the log cannot silently run without.
 */
export function auditServiceOf(services: Readonly<Record<string, unknown>>): AuditService {
  const service = services.audit as AuditService | undefined;
  if (!service) throw new Error('This application does not compose the audit plugin');
  return service;
}

import {
  failClosedAuditMode,
  type AuditMode,
  type CatalogRequirements,
  type EventLogPort,
} from '@agent-native/contracts';
import {
  createEgress,
  startEgressProxy,
  type Egress,
  type EgressProxy,
  type ResolvedPolicy,
} from '@agent-native/egress';
import {
  forwardingEventLog,
  openJsonlEventLog,
  type ForwardingEventLog,
  type JsonlEventLog,
} from '@agent-native/event-log';
import { syslogSink } from './syslog';

const bestEffortAuditMode: AuditMode = Object.freeze({
  commands: 'best-effort',
  queries: 'best-effort',
  egress: 'best-effort',
});

/**
 * The audit log under its writer lock in the policy's audit mode, its optional off-host
 * forwarder, and the egress guard (plus the child proxy) that audits into it. If the proxy
 * cannot start, the log is closed again before the error is rethrown.
 */
export async function openAuditChannel(
  policy: ResolvedPolicy,
  requirements: CatalogRequirements,
  options: {
    readonly directory: string;
    readonly application: string;
    readonly component: string;
    readonly instance: string;
    readonly childProxy?: boolean;
  },
) {
  const log: JsonlEventLog = await openJsonlEventLog({
    directory: options.directory,
    source: { component: options.component, instance: options.instance },
    mode: policy.policy.audit.mode === 'fail-closed' ? failClosedAuditMode : bestEffortAuditMode,
  });
  // The sink reaches the collector through the guard, and the guard audits into the forwarded
  // log; the closure breaks the construction cycle. Only connects are audited, not each batch.
  let egress: Egress | undefined;
  const forwardTo = policy.policy.audit.forwardTo;
  const sink = forwardTo ? syslogSink(() => egress!, forwardTo, options.application) : undefined;
  const forwarder: ForwardingEventLog | undefined = sink
    ? forwardingEventLog(log, sink)
    : undefined;
  const eventLog: EventLogPort = forwarder ?? log;
  egress = createEgress({ policy, requirements, eventLog });
  let proxy: EgressProxy | undefined;
  try {
    if (options.childProxy) proxy = await startEgressProxy(egress);
  } catch (error) {
    await log.close();
    throw error;
  }
  return { log, forwardTo, sink, forwarder, eventLog, egress, proxy };
}

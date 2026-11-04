import { failClosedAuditMode, type AuditMode, type EventLogPort } from '@tortoise/contracts';
import type { ResolvedPolicy } from '@tortoise/deployment/policy';
import {
  forwardingEventLog,
  openJsonlEventLog,
  type ForwardingEventLog,
  type JsonlEventLog,
} from '@tortoise/event-log';
import type { NetworkPort } from '@tortoise/host/plugin';
import { syslogSink } from './syslog';

const bestEffortAuditMode: AuditMode = Object.freeze({
  commands: 'best-effort',
  queries: 'best-effort',
  egress: 'best-effort',
});

/**
 * The audit log under its writer lock in the policy's audit mode, wrapped in an off-host
 * forwarder when `audit.forwardTo` names a destination. The forwarder reaches its collector
 * through `network`, read on first send: the composed port is known only once every plugin has
 * opened, and the egress guard behind it records into this same log.
 */
export async function openAuditChannel(
  policy: ResolvedPolicy,
  network: () => NetworkPort,
  options: {
    readonly directory: string;
    readonly application: string;
    readonly component: string;
    readonly instance: string;
  },
) {
  const log: JsonlEventLog = await openJsonlEventLog({
    directory: options.directory,
    source: { component: options.component, instance: options.instance },
    mode: policy.policy.audit.mode === 'fail-closed' ? failClosedAuditMode : bestEffortAuditMode,
  });
  const forwardTo = policy.policy.audit.forwardTo;
  const sink = forwardTo ? syslogSink(network, forwardTo, options.application) : undefined;
  const forwarder: ForwardingEventLog | undefined = sink
    ? forwardingEventLog(log, sink)
    : undefined;
  const eventLog: EventLogPort = forwarder ?? log;
  return { log, forwardTo, sink, forwarder, eventLog };
}

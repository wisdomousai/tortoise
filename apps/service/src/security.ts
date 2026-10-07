import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  buildCatalog,
  failClosedAuditMode,
  type AuditEvent,
  type AuditMode,
  type AuditRecord,
  type CatalogRequirements,
  type EventLogPort,
} from '@agent-native/contracts';
import {
  assertPolicyUsable,
  createEgress,
  isolatedPolicy,
  loadSitePolicy,
  startEgressProxy,
  type Egress,
  type EgressProxy,
  type ResolvedPolicy,
} from '@agent-native/egress';
import {
  digest,
  forwardingEventLog,
  openJsonlEventLog,
  readEvents,
  rfc5424,
  unresolvedCommands,
  type EventSink,
  type ForwardingEventLog,
  type JsonlEventLog,
} from '@agent-native/event-log';
import identity from '../../../app.config.json';
import { hostComponents } from './components';
import { applicationModules } from './modules';

/** Where a deployment's security configuration comes from. Both are trusted host inputs. */
export interface SecurityOptions {
  /**
   * Site policy file. Absent means isolated: loopback only, every egress destination unbound,
   * so the app runs offline-first and reports what that disables.
   */
  readonly sitePolicy?: string;
  /** Audit log directory. Default `<workspace>/audit`. One writer per directory (OS lock). */
  readonly eventLogDirectory?: string;
}

/** Requirements of the composed deployment: every module plus every host component. */
export const deploymentCatalog = () =>
  buildCatalog(applicationModules, { components: hostComponents });
export const deploymentRequirements = (): CatalogRequirements => deploymentCatalog().requirements;

const bestEffortAuditMode: AuditMode = Object.freeze({
  commands: 'best-effort',
  queries: 'best-effort',
  egress: 'best-effort',
});

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

let executableDigest: Promise<string> | undefined;
/** SHA-256 of the running executable (the compiled binary, or the Bun runtime in development). */
function digestExecutable(): Promise<string> {
  return (executableDigest ??= new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(process.execPath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  }).catch(() => 'unavailable'));
}

/**
 * Forward audit events to a bound `tcp` destination as RFC 5424 syslog with RFC 5425
 * octet-counted framing (TLS when the binding sets `tls`). The connection opens through the
 * egress guard, so it is itself declared, bound, address-checked and audited. Delivery is
 * at-most-once: a dropped connection fails the in-flight batch, which the forwarder counts.
 */
function syslogSink(egress: () => Egress, destination: string): EventSink & { close(): void } {
  const host = hostname();
  let connection: Promise<Bun.Socket<undefined>> | undefined;
  let backlog = Buffer.alloc(0);
  let waiters: { resolve(): void; reject(error: Error): void }[] = [];
  const settle = (error?: Error) => {
    for (const waiter of waiters.splice(0)) error ? waiter.reject(error) : waiter.resolve();
  };
  const reset = () => {
    connection = undefined;
    backlog = Buffer.alloc(0);
    settle(new Error('Audit collector connection closed'));
  };
  /** Write what the socket accepts; true when the backlog is empty. */
  const pump = (socket: Bun.Socket<undefined>) => {
    while (backlog.length) {
      const written = socket.write(backlog);
      if (written <= 0) return false;
      backlog = backlog.subarray(written);
    }
    settle();
    return true;
  };
  const connect = () =>
    (connection ??= egress()
      .socket(destination, {
        data() {},
        drain: (socket) => void pump(socket),
        close: reset,
        error: reset,
      })
      .catch((error: unknown) => {
        connection = undefined;
        throw error;
      }));
  const sink = async (events: readonly AuditEvent[]) => {
    const socket = await connect();
    const frames = events.map((event) => {
      const message = rfc5424(event, { appName: identity.name, hostname: host });
      return `${Buffer.byteLength(message)} ${message}`;
    });
    backlog = Buffer.concat([backlog, Buffer.from(frames.join(''))]);
    if (pump(socket)) return;
    await new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }));
  };
  return Object.assign(sink, {
    close() {
      void connection?.then((socket) => socket.end()).catch(() => undefined);
      connection = undefined;
    },
  });
}

/**
 * The deployment's security posture, opened before anything serves or writes:
 *
 * 1. Resolve the site policy against the composed requirements and refuse to start on any error
 *    finding (profile floors included). No policy file means isolated.
 * 2. Open the audit log under its writer lock, in the policy's audit mode, and wrap it in an
 *    off-host forwarder when `audit.forwardTo` names a bound destination.
 * 3. Create the egress guard over that log; with `childProxy`, start the loopback CONNECT proxy
 *    that declared child processes (provider CLIs) must use.
 *
 * Callers then run `attest()` and `recover(application)` before accepting requests, and pass
 * `eventLog`, `egress` and `proxy` to the runtime, integrations and providers. Throws on an
 * unusable policy or a locked/unwritable log; everything opened so far is closed again.
 */
export async function openSecurity(
  options: SecurityOptions & {
    readonly workspacePath: string;
    /** Audit source component, e.g. `authority` or `embedded`. */
    readonly component: string;
    readonly instance: string;
    readonly childProxy?: boolean;
  },
) {
  const catalog = deploymentCatalog();
  const requirements = catalog.requirements;
  const policy: ResolvedPolicy = options.sitePolicy
    ? await loadSitePolicy(options.sitePolicy, requirements)
    : isolatedPolicy(requirements);
  assertPolicyUsable(policy);
  const directory = options.eventLogDirectory ?? join(options.workspacePath, 'audit');
  const log: JsonlEventLog = await openJsonlEventLog({
    directory,
    source: { component: options.component, instance: options.instance },
    mode: policy.policy.audit.mode === 'fail-closed' ? failClosedAuditMode : bestEffortAuditMode,
  });
  // The sink reaches the collector through the guard, and the guard audits into the forwarded
  // log; the closure breaks the construction cycle. Only connects are audited, not each batch.
  let egress: Egress | undefined;
  const forwardTo = policy.policy.audit.forwardTo;
  const sink = forwardTo ? syslogSink(() => egress!, forwardTo) : undefined;
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
  let closed = false;
  return {
    policy,
    requirements,
    eventLog,
    egress,
    proxy,
    logDirectory: directory,
    forwarding: () => forwarder?.stats(),
    /**
     * Record what is running: `config.loaded` carries the executable, catalog and policy digests
     * so an auditor can match this instance to the SBOM and manifest; `policy.loaded` lists the
     * findings and what isolation or unbound destinations disable. Appended as required.
     */
    async attest(extra: AuditRecord['data'] = {}) {
      const records: AuditRecord[] = [
        {
          kind: 'config.loaded',
          outcome: 'info',
          data: {
            ...extra,
            application: identity.name,
            executableDigest: await digestExecutable(),
            catalogDigest: digest(catalog),
            policyDigest: policy.digest,
            profile: policy.profile,
            networkMode: policy.mode,
            auditMode: policy.policy.audit.mode,
            ...(forwardTo ? { auditForwardTo: forwardTo } : {}),
          },
        },
        {
          kind: 'policy.loaded',
          outcome: 'info',
          data: {
            profile: policy.profile,
            bound: [...policy.bindings.keys()].sort(),
            disabled: [...policy.disabled].sort(),
            findings: policy.findings.map((finding) => ({
              level: finding.level,
              code: finding.code,
              ...(finding.destination ? { destination: finding.destination } : {}),
            })),
            consequences: policy.consequences.map((item) => ({
              destination: item.destination,
              offline: item.offline,
              reason: item.reason,
            })),
          },
        },
      ];
      await log.append(records);
    },
    /**
     * Resolve `command.accepted` events left without an outcome by a crash. Must run after the
     * runtime is composed and before any request is served, so no new command reuses a cursor
     * the recovery compares against. Returns how many were resolved.
     */
    async recover(application: {
      recoverAudit(accepted: readonly AuditEvent[]): Promise<readonly AuditRecord[]>;
    }) {
      const pending = unresolvedCommands(await readEvents(directory, { kinds: recoveryKinds }));
      return pending.length ? (await application.recoverAudit(pending)).length : 0;
    },
    /** Stop the proxy, offer queued events to the collector, then release the log lock. */
    async close() {
      if (closed) return;
      closed = true;
      await proxy?.close().catch(() => undefined);
      await forwarder?.flush().catch(() => undefined);
      sink?.close();
      await log.close();
    },
  };
}
export type Security = Awaited<ReturnType<typeof openSecurity>>;

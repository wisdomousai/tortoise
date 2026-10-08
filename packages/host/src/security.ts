import { join, resolve } from 'node:path';
import type { ExecutionContext } from '@agent-native/runtime';
import {
  ApplicationError,
  type AuditEvent,
  type AuditRecord,
  type CatalogRequirements,
} from '@agent-native/contracts';
import {
  assertPolicyUsable,
  isolatedPolicy,
  loadSitePolicy,
  type ResolvedPolicy,
} from '@agent-native/egress';
import { digest, readEvents, unresolvedCommands } from '@agent-native/event-log';
import { createPostureMonitor } from '@agent-native/assurance';
import type { AnyApplicationDefinition } from './application';
import { deploymentCatalog } from './components';
import type { ApplicationManifest } from './manifest';
import { attestationRecords } from './security/attestation';
import { openAuditChannel } from './security/audit-channel';
import { digestExecutable } from './security/executable-digest';

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

/** Requirements of one deployment: the application's modules and components plus the host's. */
export const deploymentRequirements = (manifest: ApplicationManifest): CatalogRequirements =>
  deploymentCatalog(manifest).requirements;

/**
 * Security options from the environment a launcher prepares: `AGENT_NATIVE_SITE_POLICY` and
 * `AGENT_NATIVE_AUDIT_LOG`. Both are trusted host inputs; relative paths resolve against the
 * working directory.
 */
export function securityFromEnvironment(
  env: Record<string, string | undefined>,
  overrides: { sitePolicy?: string; eventLogDirectory?: string } = {},
): SecurityOptions {
  const sitePolicy = overrides.sitePolicy ?? env.AGENT_NATIVE_SITE_POLICY;
  const eventLogDirectory = overrides.eventLogDirectory ?? env.AGENT_NATIVE_AUDIT_LOG;
  return {
    ...(sitePolicy ? { sitePolicy: resolve(sitePolicy) } : {}),
    ...(eventLogDirectory ? { eventLogDirectory: resolve(eventLogDirectory) } : {}),
  };
}

/**
 * Enforce the site policy's identity floor before a session or embedded call is created.
 * `context` is the delegated context from launcher configuration, or undefined for the OS
 * account's local owner.
 *
 * - `local-owner` admits both.
 * - `grant-file` admits only a delegated context.
 * - `external` needs a workforce identity adapter this build does not compose, so it refuses
 *   rather than fall back to the local owner.
 *
 * With `grants.maxTtlSeconds`, a delegated grant must carry an expiry no further away than that.
 * Throws FORBIDDEN, or UNAVAILABLE for the missing adapter.
 */
export function assertIdentity(
  policy: ResolvedPolicy,
  context: ExecutionContext | undefined,
  now = Date.now(),
): void {
  const floor = policy.policy.identity;
  if (floor === 'external')
    throw new ApplicationError(
      'UNAVAILABLE',
      `${policy.profile} requires an external identity adapter; none is composed in this build`,
    );
  if (floor === 'grant-file' && !context?.grant)
    throw new ApplicationError(
      'FORBIDDEN',
      `${policy.profile} admits only delegated grants from launcher configuration, not the local owner`,
    );
  const maxTtlSeconds = policy.policy.grants.maxTtlSeconds;
  const expiresAt = context?.grant?.expiresAt;
  if (context?.grant && maxTtlSeconds !== undefined)
    if (expiresAt === undefined || expiresAt - now > maxTtlSeconds * 1000)
      throw new ApplicationError(
        'FORBIDDEN',
        `Delegated grants must expire within ${maxTtlSeconds} seconds under this site policy`,
      );
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
    /** The application whose declared requirements the policy binds. */
    readonly definition: AnyApplicationDefinition;
    readonly workspacePath: string;
    /** Audit source component, e.g. `authority` or `embedded`. */
    readonly component: string;
    readonly instance: string;
    readonly childProxy?: boolean;
  },
) {
  const application = options.definition.manifest.id;
  const catalog = deploymentCatalog(options.definition.manifest);
  const requirements = catalog.requirements;
  const policy: ResolvedPolicy = options.sitePolicy
    ? await loadSitePolicy(options.sitePolicy, requirements)
    : isolatedPolicy(requirements);
  assertPolicyUsable(policy);
  const directory = options.eventLogDirectory ?? join(options.workspacePath, 'audit');
  const channel = await openAuditChannel(policy, requirements, {
    ...options,
    directory,
    application,
  });
  const { log, forwardTo, sink, forwarder, eventLog, egress, proxy } = channel;
  const catalogDigest = digest(catalog);
  // Passive posture checks over this log; the assurance capabilities read through it.
  const monitor = createPostureMonitor({
    policy,
    directory,
    head: () => log.head(),
    eventLog,
    forwarding: () => forwarder?.stats(),
    attestation: async () => ({ catalogDigest, executableDigest: await digestExecutable() }),
  });
  let closed = false;
  return {
    policy,
    requirements,
    eventLog,
    egress,
    proxy,
    monitor,
    logDirectory: directory,
    forwarding: () => forwarder?.stats(),
    /** Record what is running (see `attestationRecords`). Appended as required. */
    async attest(extra: AuditRecord['data'] = {}) {
      const executableDigest = await digestExecutable();
      const facts = { application, executableDigest, catalogDigest, forwardTo };
      await log.append(attestationRecords(policy, facts, extra));
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
    /** Stop monitoring and the proxy, offer queued events to the collector, release the lock. */
    async close() {
      if (closed) return;
      closed = true;
      await monitor.stop();
      await proxy?.close().catch(() => undefined);
      await forwarder?.flush().catch(() => undefined);
      sink?.close();
      await log.close();
    },
  };
}
export type Security = Awaited<ReturnType<typeof openSecurity>>;

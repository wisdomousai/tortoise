import type { AuditEvent } from '@agent-native/contracts';
import { judgeCertificates, type ResolvedPolicy } from '@agent-native/site/policy';
import type { ForwardingStats, VerificationReport } from '@agent-native/event-log';
import { pastBestBefore } from '@agent-native/kernel/build';
import type { DestinationPosture, Posture, PostureCheck } from './contracts';

/** Per-destination egress use, accumulated from `egress.*` audit events. */
export interface EgressUsage {
  readonly allowed: number;
  readonly denied: number;
  readonly lastUsedAt?: number;
}

/** Fold audit events into per-destination usage; unknown or malformed events are ignored. */
export function accumulateEgress(
  usage: ReadonlyMap<string, EgressUsage>,
  events: readonly AuditEvent[],
): Map<string, EgressUsage> {
  const next = new Map(usage);
  for (const event of events) {
    const destination = event.data?.destination;
    if (typeof destination !== 'string') continue;
    const current = next.get(destination) ?? { allowed: 0, denied: 0 };
    if (event.kind === 'egress.allowed')
      next.set(destination, { ...current, allowed: current.allowed + 1, lastUsedAt: event.at });
    else if (event.kind === 'egress.denied')
      next.set(destination, { ...current, denied: current.denied + 1 });
  }
  return next;
}

export interface PostureInput {
  readonly policy: ResolvedPolicy;
  readonly verification?: VerificationReport;
  readonly forwarding?: ForwardingStats;
  readonly usage?: ReadonlyMap<string, EgressUsage>;
  readonly attestation?: { readonly catalogDigest?: string; readonly executableDigest?: string };
  /** The running build's best-before date, `YYYY-MM-DD`, when it carries one. */
  readonly bestBefore?: string;
  readonly now: number;
}

function policyCheck(policy: ResolvedPolicy): PostureCheck {
  const errors = policy.findings.filter((finding) => finding.level === 'error');
  const warnings = policy.findings.filter((finding) => finding.level === 'warning');
  return {
    id: 'policy',
    status: errors.length ? 'fail' : warnings.length ? 'warn' : 'pass',
    summary: errors.length
      ? `${errors.length} policy error(s): ${errors.map((finding) => finding.code).join(', ')}`
      : warnings.length
        ? `${warnings.length} warning(s): ${[...new Set(warnings.map((finding) => finding.code))].join(', ')}`
        : `Site policy satisfies the ${policy.profile} profile`,
  };
}

/**
 * Certificate validity judged at the time of this check, not when the policy was loaded, so a
 * certificate that expires while the host runs turns this check to `fail`.
 */
function certificateCheck(policy: ResolvedPolicy, now: number): PostureCheck {
  if (!policy.certificates.length)
    return { id: 'certificates', status: 'info', summary: 'No certificates are configured' };
  const problems = judgeCertificates(policy.certificates, now);
  const errors = problems.filter((problem) => problem.level === 'error');
  const soonest = Math.min(
    ...policy.certificates.filter((item) => item.notAfter > now).map((item) => item.notAfter),
  );
  return errors.length
    ? { id: 'certificates', status: 'fail', summary: errors.map((item) => item.message).join('; ') }
    : problems.length
      ? {
          id: 'certificates',
          status: 'warn',
          summary: problems.map((item) => item.message).join('; '),
        }
      : {
          id: 'certificates',
          status: 'pass',
          summary: `${policy.certificates.length} certificate(s) valid; the first expires ${new Date(soonest).toISOString().slice(0, 10)}`,
        };
}

/** A best-before date this close or closer turns its check to `warn`. */
const BEST_BEFORE_WARNING_MS = 30 * 86_400_000;

/**
 * The build's best-before date, judged at the time of this check. A build past it, or within 30
 * days of it, is a `warn` for a reviewer; it is never a `fail`, because nothing is refused for it.
 */
function bestBeforeCheck(bestBefore: string | undefined, now: number): PostureCheck {
  if (!bestBefore)
    return {
      id: 'best-before',
      status: 'info',
      summary:
        'This build has no best-before date: the application declares no shelf life, or runs from source',
    };
  if (pastBestBefore(bestBefore, now))
    return {
      id: 'best-before',
      status: 'warn',
      summary: `Past its best-before date of ${bestBefore}`,
    };
  return pastBestBefore(bestBefore, now + BEST_BEFORE_WARNING_MS)
    ? { id: 'best-before', status: 'warn', summary: `Best before ${bestBefore}, within 30 days` }
    : { id: 'best-before', status: 'pass', summary: `Best before ${bestBefore}` };
}

function auditChainCheck(verification: VerificationReport | undefined): PostureCheck {
  return !verification
    ? { id: 'audit-chain', status: 'warn', summary: 'Audit chain not verified yet' }
    : verification.ok
      ? {
          id: 'audit-chain',
          status: 'pass',
          summary: `${verification.events} events verified up to ${verification.head?.seq ?? 0}`,
        }
      : {
          id: 'audit-chain',
          status: 'fail',
          summary: `${verification.problems.length} integrity problem(s), first: ${verification.problems[0]!.problem}`,
        };
}

function forwardingCheck(
  forwardTo: string | undefined,
  forwarding: ForwardingStats | undefined,
): PostureCheck {
  return !forwardTo
    ? {
        id: 'audit-forwarding',
        status: 'info',
        summary: 'Events stay on this host; no off-host collector is configured',
      }
    : !forwarding
      ? {
          id: 'audit-forwarding',
          status: 'warn',
          summary: `Forwarding to ${forwardTo} not started`,
        }
      : forwarding.dropped || forwarding.failures
        ? {
            id: 'audit-forwarding',
            status: 'warn',
            summary: `${forwarding.dropped} event(s) not forwarded to ${forwardTo} after ${forwarding.failures} failure(s)`,
          }
        : {
            id: 'audit-forwarding',
            status: 'pass',
            summary: `${forwarding.forwarded} event(s) forwarded to ${forwardTo}`,
          };
}

/** Denied egress, required destinations that are off, and bindings never used. */
function egressChecks(
  policy: ResolvedPolicy,
  usage: ReadonlyMap<string, EgressUsage>,
): PostureCheck[] {
  const denied = [...usage].filter(([, item]) => item.denied > 0);
  const requiredOff = policy.consequences.filter((item) => item.availability === 'required');
  const unused = [...policy.bindings.keys()].filter((id) => !usage.get(id)?.allowed).sort();
  return [
    denied.length
      ? {
          id: 'egress-denials',
          status: 'warn',
          summary: `Denied egress to ${denied.map(([id, item]) => `${id} (${item.denied})`).join(', ')}`,
        }
      : { id: 'egress-denials', status: 'pass', summary: 'No egress was denied' },
    requiredOff.length
      ? {
          id: 'required-destinations',
          status: 'warn',
          summary: `Required destinations not reachable (${requiredOff.map((item) => `${item.destination}: ${item.reason}, ${item.offline}`).join('; ')})`,
        }
      : {
          id: 'required-destinations',
          status: 'pass',
          summary: 'Every required destination is bound',
        },
    {
      id: 'unused-bindings',
      status: 'info',
      summary: unused.length
        ? `Bound but not used since the log began: ${unused.join(', ')}`
        : 'Every bound destination has been used',
    },
  ];
}

/** Every declared destination, sorted by ID, with its state and usage. */
function destinationPostures(
  policy: ResolvedPolicy,
  usage: ReadonlyMap<string, EgressUsage>,
): DestinationPosture[] {
  const consequence = new Map(policy.consequences.map((item) => [item.destination, item]));
  return [...policy.declared.values()]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((declared) => {
      const binding = policy.bindings.get(declared.id);
      const reason = consequence.get(declared.id)?.reason;
      const used = usage.get(declared.id);
      return {
        id: declared.id,
        owner: declared.owner,
        direction: declared.direction,
        scope: declared.scope,
        availability: declared.availability,
        state: binding
          ? 'bound'
          : policy.disabled.has(declared.id)
            ? 'disabled'
            : reason === 'isolated'
              ? 'isolated'
              : declared.direction === 'ingress' || declared.scope === 'loopback'
                ? 'local'
                : 'unbound',
        ...(binding ? { origin: `${binding.url.protocol}//${binding.url.host}` } : {}),
        ...(declared.offline ? { offline: declared.offline } : {}),
        allowed: used?.allowed ?? 0,
        denied: used?.denied ?? 0,
        ...(used?.lastUsedAt !== undefined ? { lastUsedAt: used.lastUsedAt } : {}),
      };
    });
}

/**
 * Judge the running posture from facts the host already has: the resolved policy, a chain
 * verification, forwarding statistics and egress usage. Never probes the network. `failing`
 * means the audit trail or policy cannot be trusted; `attention` means something a reviewer
 * should look at (denials, unforwarded events, required features switched off).
 */
export function assessPosture(input: PostureInput): Posture {
  const { policy, verification, forwarding } = input;
  const usage = input.usage ?? new Map<string, EgressUsage>();
  const forwardTo = policy.policy.audit.forwardTo;
  const checks: PostureCheck[] = [
    policyCheck(policy),
    certificateCheck(policy, input.now),
    bestBeforeCheck(input.bestBefore, input.now),
    auditChainCheck(verification),
    forwardingCheck(forwardTo, forwarding),
    ...egressChecks(policy, usage),
  ];
  const status = checks.some((check) => check.status === 'fail')
    ? 'failing'
    : checks.some((check) => check.status === 'warn')
      ? 'attention'
      : 'ok';
  return {
    checkedAt: input.now,
    status,
    profile: policy.profile,
    networkMode: policy.mode,
    auditMode: policy.policy.audit.mode,
    policyDigest: policy.digest,
    ...(input.attestation?.catalogDigest ? { catalogDigest: input.attestation.catalogDigest } : {}),
    ...(input.attestation?.executableDigest
      ? { executableDigest: input.attestation.executableDigest }
      : {}),
    checks,
    destinations: destinationPostures(policy, usage),
    findings: policy.findings.map((finding) => ({
      level: finding.level,
      code: finding.code,
      ...(finding.destination ? { destination: finding.destination } : {}),
    })),
    log: {
      headSeq: verification?.head?.seq ?? 0,
      verified: verification?.ok ?? false,
      problems: verification?.problems.length ?? 0,
      checkpoints: verification?.checkpoints ?? 0,
    },
    ...(forwardTo && forwarding ? { forwarding: { destination: forwardTo, ...forwarding } } : {}),
  };
}

/** Markdown audit report: posture, destinations and recent denials, for an audit pack. */
export function postureMarkdown(
  posture: Posture,
  options: { readonly application: string; readonly denials?: readonly AuditEvent[] },
): string {
  const time = (value: number) => new Date(value).toISOString();
  return [
    `# Security posture: ${options.application}`,
    '',
    `Checked ${time(posture.checkedAt)}. Status: **${posture.status}**. Profile \`${posture.profile}\`, network ${posture.networkMode}, audit ${posture.auditMode}.`,
    '',
    `- Policy digest: \`${posture.policyDigest}\``,
    ...(posture.catalogDigest ? [`- Catalog digest: \`${posture.catalogDigest}\``] : []),
    ...(posture.executableDigest ? [`- Executable digest: \`${posture.executableDigest}\``] : []),
    `- Audit log: head ${posture.log.headSeq}, ${posture.log.verified ? 'verified' : 'NOT verified'}, ${posture.log.problems} problem(s), ${posture.log.checkpoints} checkpoint(s)`,
    '',
    '## Checks',
    '',
    '| Check | Status | Summary |',
    '| --- | --- | --- |',
    ...posture.checks.map(
      (check) => `| ${check.id} | ${check.status} | ${check.summary.replace(/\|/g, '\\|')} |`,
    ),
    '',
    '## Destinations',
    '',
    '| ID | Owner | Scope | State | Origin | Allowed | Denied | Last used |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...posture.destinations.map(
      (item) =>
        `| \`${item.id}\` | ${item.owner} | ${item.scope} | ${item.state} | ${item.origin ?? '—'} | ${item.allowed} | ${item.denied} | ${item.lastUsedAt ? time(item.lastUsedAt) : '—'} |`,
    ),
    '',
    ...(options.denials?.length
      ? [
          '## Recent denials',
          '',
          '| Seq | Time | Kind | Operation or destination | Reason | Actor |',
          '| --- | --- | --- | --- | --- | --- |',
          ...options.denials.map(
            (event) =>
              `| ${event.seq} | ${time(event.at)} | ${event.kind} | ${event.operation ?? String(event.data?.destination ?? '—')} | ${event.reason ?? '—'} | ${event.actor?.principalId ?? '—'} |`,
          ),
          '',
        ]
      : []),
  ].join('\n');
}

import type { AuditRecord } from '@agent-native/contracts';
import type { ResolvedPolicy } from '@agent-native/site/policy';

/**
 * What is running: `config.loaded` carries the executable, catalog and policy digests so an
 * auditor can match this instance to the SBOM and manifest; `policy.loaded` lists the findings
 * and what isolation or unbound destinations disable.
 */
export function attestationRecords(
  policy: ResolvedPolicy,
  facts: {
    readonly application: string;
    readonly executableDigest: string;
    readonly catalogDigest: string;
    readonly forwardTo?: string;
  },
  extra: AuditRecord['data'],
): AuditRecord[] {
  return [
    {
      kind: 'config.loaded',
      outcome: 'info',
      data: {
        ...extra,
        application: facts.application,
        executableDigest: facts.executableDigest,
        catalogDigest: facts.catalogDigest,
        policyDigest: policy.digest,
        profile: policy.profile,
        networkMode: policy.mode,
        auditMode: policy.policy.audit.mode,
        ...(facts.forwardTo ? { auditForwardTo: facts.forwardTo } : {}),
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
}

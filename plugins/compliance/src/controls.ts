/**
 * Generic security controls the framework implements, each mapped to the frameworks auditors
 * ask about and to evidence they can re-run. IDs are stable (`AN-<area>-<n>`); add, never
 * renumber. Mappings are indicative: they name the requirement a control contributes to, and
 * a certification still needs the organization's own scoping and the licensed standard text.
 */
export interface Control {
  readonly id: string;
  readonly title: string;
  /** What the software does, in one or two sentences. */
  readonly implementation: string;
  /** What it does not do, or what the deployment must add. */
  readonly limits?: string;
  readonly status: 'implemented' | 'partial';
  readonly mappings: {
    /** ISO/IEC 27001:2022 Annex A. */
    readonly iso27001: readonly string[];
    /** NIST SP 800-53 Rev. 5. */
    readonly nist80053: readonly string[];
    /** NIST Cybersecurity Framework 2.0 subcategories. */
    readonly csf: readonly string[];
    /** IEC 62443-4-2 component requirements. */
    readonly iec62443: readonly string[];
  };
  readonly evidence: {
    /** Test files that demonstrate the behaviour; `bun test <file>` re-runs them. */
    readonly tests: readonly string[];
    /**
     * Generated or exported artifacts: a file `bun run generate` writes for each application under
     * `dist/reference/<id>/`, a file in a signed site bundle, or a CLI export.
     */
    readonly artifacts: readonly string[];
    /** Audit event kinds that show the control operating at runtime. */
    readonly events: readonly string[];
  };
}

export const controls: readonly Control[] = [
  {
    id: 'AN-NET-01',
    title: 'Declared network, device and process requirements',
    implementation:
      'Every module and host component declares each network destination with purpose, scope, protocol, data classes, availability and offline behaviour, plus devices and child processes. The catalog build rejects an outbox target without a declared destination.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.5.9', 'A.5.14', 'A.8.20'],
      nist80053: ['CM-8', 'CA-3', 'CA-9', 'PL-8'],
      csf: ['ID.AM-02', 'ID.AM-03'],
      iec62443: ['CR 7.8'],
    },
    evidence: {
      tests: ['packages/contracts/test/contracts.test.ts'],
      artifacts: ['security-manifest.json', 'data-flows.md'],
      events: ['policy.loaded'],
    },
  },
  {
    id: 'AN-NET-02',
    title: 'Deny-by-default egress with origin and address checks',
    implementation:
      'Outbound requests go through the egress guard: only declared destinations bound by the site policy, only at their bound origin, redirects revalidated per hop, resolved addresses checked against the bound networks, with timeouts and response-size caps.',
    limits:
      'In-process enforcement; a resolver that answers differently between check and connect can race the address check. The exported OS rules close that gap.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.8.12', 'A.8.20', 'A.8.22'],
      nist80053: ['AC-4', 'SC-7', 'SC-7(5)'],
      csf: ['PR.IR-01'],
      iec62443: ['CR 5.1'],
    },
    evidence: {
      tests: ['plugins/network/test/guard.test.ts', 'examples/project-tasks/test/security.test.ts'],
      artifacts: [],
      events: ['egress.allowed', 'egress.denied', 'egress.completed'],
    },
  },
  {
    id: 'AN-NET-03',
    title: 'Operating-system rules generated from the same policy',
    implementation:
      'The site policy exports to nftables, Windows Firewall, Kubernetes NetworkPolicy and a systemd unit with IPAddressDeny=any. Bound destinations without addresses are listed as not enforced instead of being widened.',
    limits:
      'Rules are exported, not applied; applying and keeping them current is a deployment step.',
    status: 'partial',
    mappings: {
      iso27001: ['A.8.20', 'A.8.22'],
      nist80053: ['SC-7', 'CM-7'],
      csf: ['PR.IR-01', 'PR.PS-01'],
      iec62443: ['CR 5.1', 'CR 7.6'],
    },
    evidence: {
      tests: ['plugins/network/test/network.test.ts'],
      artifacts: ['network export --format nftables|windows-firewall|k8s-networkpolicy|systemd'],
      events: [],
    },
  },
  {
    id: 'AN-NET-04',
    title: 'Offline-first, isolated by default',
    implementation:
      'Without a site policy the application binds nothing off-host. Outbox targets queue, optional features report themselves unavailable, and the consequence list is recorded at startup.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.5.30', 'A.8.22'],
      nist80053: ['CM-7', 'SC-7'],
      csf: ['PR.IR-03'],
      iec62443: ['CR 7.7'],
    },
    evidence: {
      tests: [
        'examples/project-tasks/test/security.test.ts',
        'plugins/site/test/policy.test.ts',
        'plugins/network/test/guard.test.ts',
      ],
      artifacts: ['data-flows.md'],
      events: ['policy.loaded', 'effect.enqueued'],
    },
  },
  {
    id: 'AN-NET-05',
    title: 'Child processes confined to their declared destinations',
    implementation:
      'Provider CLIs and other children receive proxy settings with a per-process credential; the loopback CONNECT proxy tunnels only to destinations the process declaration lists and audits each tunnel.',
    limits: 'A child that ignores proxy settings is contained only by the exported OS rules.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.8.20'],
      nist80053: ['AC-4', 'SC-7', 'SC-39'],
      csf: ['PR.IR-01'],
      iec62443: ['CR 5.1'],
    },
    evidence: {
      tests: ['plugins/network/test/guard.test.ts'],
      artifacts: ['data-flows.md'],
      events: ['egress.allowed', 'egress.denied'],
    },
  },
  {
    id: 'AN-CRY-01',
    title: 'Encrypted transport floor and certificate pinning',
    implementation:
      'Sandbox and zero-trust profiles refuse plain-text bindings to site or internet destinations; bindings can replace the CA bundle and pin server certificates by SHA-256 fingerprint.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.5.14', 'A.8.24'],
      nist80053: ['SC-8', 'SC-13', 'SC-17'],
      csf: ['PR.DS-02'],
      iec62443: ['CR 3.1', 'CR 4.1', 'CR 4.3', 'CR 1.8'],
    },
    evidence: {
      tests: ['plugins/site/test/policy.test.ts', 'plugins/network/test/guard.test.ts'],
      artifacts: [],
      events: ['policy.loaded'],
    },
  },
  {
    id: 'AN-AUD-01',
    title: 'Audit events for every business action, denial and delivery',
    implementation:
      'The runtime records accepted, committed, replayed, denied and failed commands, queries, outbox transitions and delivery attempts with actor, channel, correlation and cursor; the egress guard records every connection decision.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.8.15'],
      nist80053: ['AU-2', 'AU-3', 'AU-12'],
      csf: ['PR.PS-04', 'DE.CM-03'],
      iec62443: ['CR 2.8'],
    },
    evidence: {
      tests: [
        'packages/runtime/test/audit.test.ts',
        'examples/project-tasks/test/security.test.ts',
      ],
      artifacts: [],
      events: [
        'command.accepted',
        'command.committed',
        'command.denied',
        'query.executed',
        'effect.attempted',
        'effect.settled',
      ],
    },
  },
  {
    id: 'AN-AUD-02',
    title: 'Fail closed when the audit log cannot be written',
    implementation:
      'In fail-closed mode the accepted event is appended inside the storage transaction after final authorization; if the append fails, the transaction rolls back and the caller receives UNAVAILABLE. Egress with a required log does not connect unlogged.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.8.15'],
      nist80053: ['AU-5', 'SC-24'],
      csf: ['PR.PS-04'],
      iec62443: ['CR 2.10'],
    },
    evidence: {
      tests: ['packages/runtime/test/audit.test.ts', 'plugins/network/test/guard.test.ts'],
      artifacts: [],
      events: ['command.accepted'],
    },
  },
  {
    id: 'AN-AUD-03',
    title: 'Tamper-evident, single-writer audit storage',
    implementation:
      'Events are SHA-256 hash-chained across fsynced, size-rotated JSON-lines segments (0600 files, 0700 directory) with periodic checkpoints and an OS writer lock. The verifier detects edits, removals, reordering and truncation.',
    limits:
      'Detects tampering; it cannot prevent a privileged local user rewriting the whole log. Compare the head with a forwarded copy.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.5.28', 'A.5.33', 'A.8.15'],
      nist80053: ['AU-9', 'AU-9(3)', 'AU-10', 'AU-11'],
      csf: ['PR.DS-01', 'PR.PS-04'],
      iec62443: ['CR 2.12', 'CR 3.9'],
    },
    evidence: {
      tests: [
        'packages/event-log/test/event-log.test.ts',
        'examples/quality-inspection/test/security.test.ts',
      ],
      artifacts: ['audit verify --log <dir>'],
      events: ['log.opened', 'log.checkpoint'],
    },
  },
  {
    id: 'AN-AUD-04',
    title: 'Off-host audit forwarding',
    implementation:
      'With `audit.forwardTo`, sealed events are forwarded as RFC 5424 syslog with octet-counted framing to a declared, bound collector through the egress guard. The zero-trust profile requires it.',
    limits:
      'Delivery is at-most-once with a bounded queue; drops are counted and reported in posture checks.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.8.15', 'A.8.16'],
      nist80053: ['AU-4(1)', 'AU-9(2)', 'AU-6(3)'],
      csf: ['DE.AE-03', 'PR.PS-04'],
      iec62443: ['CR 2.9', 'CR 6.1'],
    },
    evidence: {
      tests: ['packages/event-log/test/event-log.test.ts'],
      artifacts: [],
      events: ['posture.checked'],
    },
  },
  {
    id: 'AN-AUD-05',
    title: 'Data minimization in audit records',
    implementation:
      'Inputs are recorded as a SHA-256 digest plus field names; only fields a capability allow-lists appear in plain text. Error text in the log is framework-generated and bounded, never handler free text or response bodies.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.5.34', 'A.8.11'],
      nist80053: ['AU-3', 'SI-12'],
      csf: ['PR.DS-01'],
      iec62443: ['CR 4.1'],
    },
    evidence: {
      tests: [
        'packages/runtime/test/audit.test.ts',
        'examples/project-tasks/test/security.test.ts',
      ],
      artifacts: ['data-flows.md'],
      events: ['command.accepted'],
    },
  },
  {
    id: 'AN-AUD-06',
    title: 'Time-stamped, ordered records',
    implementation:
      'Each event carries the host clock time and a gap-free sequence number; ordering is by sequence, so clock steps cannot reorder the chain.',
    limits: 'Time accuracy depends on host clock synchronization, which the deployment provides.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.8.17'],
      nist80053: ['AU-8'],
      csf: ['PR.PS-04'],
      iec62443: ['CR 2.11'],
    },
    evidence: {
      tests: ['packages/event-log/test/event-log.test.ts'],
      artifacts: [],
      events: ['log.opened'],
    },
  },
  {
    id: 'AN-MON-01',
    title: 'Continuous posture monitoring',
    implementation:
      'The running authority re-checks policy findings, chain integrity, forwarding health and denied egress on startup and on an interval, records `posture.checked`, and serves the result to authorized auditors through the compliance capabilities.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.8.16'],
      nist80053: ['CA-7', 'SI-4', 'AU-6'],
      csf: ['DE.CM-01', 'DE.CM-09'],
      iec62443: ['CR 3.3', 'CR 6.2'],
    },
    evidence: {
      tests: ['plugins/compliance/test/compliance.test.ts'],
      artifacts: ['compliance report --log <dir>'],
      events: ['posture.checked'],
    },
  },
  {
    id: 'AN-IAC-01',
    title: 'Authorization of operation, object and fields inside the transaction',
    implementation:
      'Every command and query is authorized against current state inside the storage transaction, rows are filtered before pagination, delegated grants are rechecked per call, and denials are audited.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.5.15', 'A.5.18', 'A.8.3'],
      nist80053: ['AC-3', 'AC-6'],
      csf: ['PR.AA-05'],
      iec62443: ['CR 2.1'],
    },
    evidence: {
      tests: [
        'packages/runtime/test/runtime.test.ts',
        'examples/project-tasks/test/security-conformance.test.ts',
      ],
      artifacts: ['contract.json'],
      events: ['command.denied', 'query.denied'],
    },
  },
  {
    id: 'AN-IAC-02',
    title: 'Identity and ingress floors for sandbox and zero-trust profiles',
    implementation:
      'Profiles refuse to start below their floor. Under a grant-file identity the host issues no local-owner session or credential file and admits only the launcher grant, which must expire within the policy maximum; embedded CLI calls are held to the same rule. The only non-loopback listener is mutual TLS against the site client CA, and a session is still required on top of the certificate. Zero trust also requires an off-host audit forwarder.',
    limits:
      'Workforce sign-in is OpenID Connect only and has not been run against a real provider; SAML, LDAP and certificate issuance are not part of this framework. External identity refuses to start without a bound provider instead of falling back.',
    status: 'partial',
    mappings: {
      iso27001: ['A.5.16', 'A.5.17', 'A.8.5'],
      nist80053: ['IA-2', 'IA-3', 'IA-9', 'SC-23'],
      csf: ['PR.AA-01', 'PR.AA-03'],
      iec62443: ['CR 1.1', 'CR 1.2'],
    },
    evidence: {
      tests: [
        'plugins/site/test/policy.test.ts',
        'examples/project-tasks/test/security.test.ts',
        'examples/project-tasks/test/hardening.test.ts',
      ],
      artifacts: ['network export --format k8s-networkpolicy|nftables'],
      events: ['config.loaded'],
    },
  },
  {
    id: 'AN-CFG-01',
    title: 'Configuration validation and runtime attestation',
    implementation:
      'The site policy is schema-validated against the composed declarations before anything opens; startup records the executable, catalog and policy digests and the profile, so a running instance can be matched to its SBOM and manifest.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.8.9', 'A.8.32'],
      nist80053: ['CM-2', 'CM-6', 'SI-7'],
      csf: ['PR.PS-01'],
      iec62443: ['CR 3.4', 'CR 7.6'],
    },
    evidence: {
      tests: [
        'examples/project-tasks/test/security.test.ts',
        'examples/quality-inspection/test/security.test.ts',
        'plugins/site/test/policy.test.ts',
      ],
      artifacts: ['site check --site <file>'],
      events: ['config.loaded', 'policy.loaded'],
    },
  },
  {
    id: 'AN-SUP-01',
    title: 'Software bill of materials',
    implementation:
      'A CycloneDX 1.6 SBOM is generated from the lockfile when a site bundle is built, with hashes, runtime/development scope and the dependency graph, and lists declared network destinations as services with their data flows. It is signed with the bundle it describes.',
    limits:
      'Licenses are not recorded in the lockfile and are omitted; vulnerability matching is a separate process.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.5.21', 'A.8.8'],
      nist80053: ['CM-8', 'SR-4'],
      csf: ['ID.AM-02', 'GV.SC-07'],
      iec62443: ['CR 7.8'],
    },
    evidence: {
      tests: ['plugins/compliance/test/compliance.test.ts'],
      artifacts: ['sbom.cdx.json in each signed site bundle (scripts/bundle.ts)'],
      events: [],
    },
  },
  {
    id: 'AN-SUP-02',
    title: 'Packaged resource integrity',
    implementation:
      'The desktop build verifies the service executable, the shipped site policy and provider runtimes against digests in its runtime manifest before launching them.',
    limits: 'Detects damaged or swapped files; it does not replace platform code signing.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.8.19'],
      nist80053: ['SI-7', 'CM-14'],
      csf: ['PR.PS-02'],
      iec62443: ['CR 3.4'],
    },
    evidence: {
      tests: ['apps/desktop/test/packaging.test.ts'],
      artifacts: [],
      events: [],
    },
  },
  {
    id: 'AN-DEV-01',
    title: 'Generated, drift-checked contracts and enforced boundaries',
    implementation:
      'API, MCP, CLI and security documentation are generated from one composed catalog and drift-checked in CI; a boundary check keeps server-only packages out of browser code.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.8.25', 'A.8.27', 'A.8.28'],
      nist80053: ['SA-8', 'SA-11'],
      csf: ['PR.PS-06'],
      // Development-process requirements sit in IEC 62443-4-1, which this catalog does not map.
      iec62443: [],
    },
    evidence: {
      tests: ['scripts/check-boundaries.ts'],
      artifacts: ['contract.json', 'security-manifest.json'],
      events: [],
    },
  },
  {
    id: 'AN-DEV-02',
    title: 'Schema-validated input on every channel',
    implementation:
      'HTTP, MCP, CLI, embedded and agent tool calls all pass the same JSON Schema validation before authorization and execution.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.8.26', 'A.8.28'],
      nist80053: ['SI-10'],
      csf: ['PR.PS-06'],
      iec62443: ['CR 3.5'],
    },
    evidence: {
      tests: ['examples/project-tasks/test/transport-conformance.test.ts'],
      artifacts: ['openapi.json'],
      events: ['command.failed'],
    },
  },
  {
    id: 'AN-RES-01',
    title: 'Resource limits on external input and output',
    implementation:
      'Request bodies, prompts, outbound responses, redirects and proxy headers are size- or count-limited, and outbound calls time out.',
    status: 'implemented',
    mappings: {
      iso27001: ['A.8.6'],
      nist80053: ['SC-5'],
      csf: ['PR.IR-04'],
      iec62443: ['CR 7.1', 'CR 7.2'],
    },
    evidence: {
      tests: ['plugins/network/test/guard.test.ts'],
      artifacts: [],
      events: ['egress.denied'],
    },
  },
];

const list = (values: readonly string[]) => values.join(', ') || '—';
const frameworks = [
  ['iso27001', 'ISO/IEC 27001:2022 Annex A'],
  ['nist80053', 'NIST SP 800-53 Rev. 5'],
  ['csf', 'NIST CSF 2.0'],
  ['iec62443', 'IEC 62443-4-2'],
] as const;

/** Readable control mapping with a per-framework index, for reviewers and audit packs. */
export function controlsMarkdown(catalog: readonly Control[] = controls): string {
  const lines = [
    '# Security controls',
    '',
    'Generated by `bun run generate` from `plugins/compliance/src/controls.ts`. Mappings are indicative: they name the requirement each control contributes to. Certification still needs your own scope and the licensed standard text. Re-run the evidence tests with `bun test <file>`.',
    '',
    '| Control | Title | Status | ISO 27001 | NIST 800-53 | CSF 2.0 | IEC 62443-4-2 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...catalog.map(
      (control) =>
        `| [${control.id}](#${control.id.toLowerCase()}) | ${control.title} | ${control.status} | ${list(control.mappings.iso27001)} | ${list(control.mappings.nist80053)} | ${list(control.mappings.csf)} | ${list(control.mappings.iec62443)} |`,
    ),
    '',
  ];
  for (const control of catalog)
    lines.push(
      `## ${control.id}`,
      '',
      `**${control.title}** (${control.status})`,
      '',
      control.implementation,
      '',
      ...(control.limits ? [`Limits: ${control.limits}`, ''] : []),
      `- Tests: ${list(control.evidence.tests.map((item) => `\`${item}\``))}`,
      `- Artifacts: ${list(control.evidence.artifacts.map((item) => `\`${item}\``))}`,
      `- Runtime events: ${list(control.evidence.events.map((item) => `\`${item}\``))}`,
      '',
    );
  lines.push('## Index by framework', '');
  for (const [key, name] of frameworks) {
    const index = new Map<string, string[]>();
    for (const control of catalog)
      for (const reference of control.mappings[key])
        index.set(reference, [...(index.get(reference) ?? []), control.id]);
    lines.push(
      `### ${name}`,
      '',
      ...[...index]
        .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
        .map(([reference, ids]) => `- ${reference}: ${ids.join(', ')}`),
      '',
    );
  }
  return lines.join('\n');
}

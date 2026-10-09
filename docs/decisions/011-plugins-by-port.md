# 011 — Framework plugins split by port

Accepted. Amends [ADR 010](010-host-plugins.md), [P11](../principles.md#p11--framework-starter-and-content-are-separate-layers-and-an-authority-runs-one-application) and [P13](../principles.md#p13--the-application-reaches-only-what-it-declares-and-the-site-binds-and-records-what-it-does). The controls of [ADR 007](007-declared-egress-and-audit-log.md) are unchanged. What changes is which plugin owns each one and what the plugins are called.

**Context.** ADR 010 shipped two framework plugins. `security` provided all four kernel ports from the site policy: the egress guard and child proxy, mTLS ingress, the identity floor, and the audit log with forwarding, attestation and recovery. `assurance` held the auditor queries and posture monitor, together with the control mapping, SBOM and data flows, plus the OS and orchestrator firewall exports. Neither name said what the plugin did. "Security" covered a network guard and an audit trail. "Assurance" was mostly compliance evidence but also generated firewall rules. A deployment that wanted a guarded network without an audit trail, or an audit trail without compliance screens, had no way to say so. The kernel already split these concerns into separate ports, and the plugins did not follow that split.

**Decision.**

- **One plugin per concern, aligned with the kernel's ports.** Composition order is `site`, `network`, `audit`, `compliance`.
  - `@agent-native/site` owns the `site-policy` setting. It resolves the policy and refuses one below its profile floor. It provides the `identity` port, exposes the resolved policy as its service, and adds `site check`.
  - `@agent-native/network` requires `site`. It provides the `network` port (egress guard, plus the child proxy in a serving host) and, under mTLS, the `ingress` port. It adds `network export`, which takes over the OS and orchestrator rule exporters from assurance.
  - `@agent-native/audit` requires `site`. It owns the `audit-log` setting and the `audit-collector` destination. It provides the `eventLog` port, attests and recovers in `ready`, and adds `audit verify`.
  - `@agent-native/compliance` requires `site` and `audit`. It owns the `compliance` slice, the `compliance.*` auditor queries, the posture monitor, the Compliance screen, the control mapping, the SBOM, the security manifest and data flows, and `compliance report`.
- **Plugins use each other through ports, not imports.** The egress guard records into the audit log, and the audit forwarder reaches its collector through the guard. Under one plugin a closure broke that cycle. Across plugins, `PluginOpenContext.ports` gives every plugin a late-bound view of the composed ports. Reading a member during `open` throws. Once every plugin has opened, the view returns whichever plugin provides the port. Network records into the event-log port, and audit forwards through the network port. Neither imports the other.
- **A configuration declares the ports it needs.** `PluginInstance.needs` lists ports that another plugin must provide, and the host refuses to start when one keeps its kernel default. Each needed port follows from something the supplied policy asks for:
  - binding destinations (connected mode) needs `network`;
  - selecting mTLS needs `ingress`;
  - asking for a fail-closed or forwarded audit trail needs `eventLog`.

  This extends ADR 010's rule for unclaimed settings: a policy that would go unenforced refuses to start instead of looking enforced. Without a policy file the application runs isolated and needs nothing.

- **The auditor queries stay with compliance.** `events.list` and `log.verify` read the audit log, but they share one auditor list, one policy over `Audit` and one screen with `posture.get`. Moving them to `audit` would split one auditor role across two slices. The audit plugin therefore adds no module. Without compliance, an application keeps its audit trail, and the CLI can still verify it.
- **Names.** Operation ids become `compliance.posture.get`, `compliance.events.list` and `compliance.log.verify`. The UI binding becomes `compliance-posture`, the screen route `/compliance`, and the registry item `compliance-screen`. The CLI verbs become `site check`, `network export`, `audit verify` and `compliance report`. Nothing was published, so no aliases are kept.

**Consequences.**

- An application states its trust posture by the plugins it lists. Every example lists all four.
- The audit forwarder's connection goes through the network port. Without the network plugin it is refused like any other connection, and the forwarder counts the failure.
- Plugins close in reverse order. Audit therefore flushes its forwarder while network is still open.
- Persisted `assurance` slices from before this change are not migrated. A workspace created earlier gets a fresh `compliance` slice whose only auditor is the owner.
- `services.security` no longer exists. Tests and plugins read `services.site`, `services.network` or `services.audit` through `siteServiceOf`, `networkServiceOf` and `auditServiceOf`.

**Alternatives considered.**

- Rename only (`security` to `site`, `assurance` to `compliance`): cheaper, but it would keep one plugin providing four ports, so a deployment still could not compose a guarded network without an audit trail.
- A separate `identity` plugin: the identity floor is a few lines that read the site policy, and no workforce identity adapter exists yet. It stays in `site` until a real adapter needs its own plugin.
- Optional `requires` between network and audit: each plugin would import the other's service type, the construction cycle would stay, and the order between them would become significant. Late-bound ports remove both problems.

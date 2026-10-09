# 007 — Declared reach, site policy and a fail-closed audit trail

Accepted. Serves [P13](../principles.md#p13--declared-reach-recorded-actions). [ADR 010](010-host-plugins.md) moved the enforcement into host plugins without changing these controls. The operator's guide is [security and compliance](../security-and-compliance.md).

**Context.** Industrial and regulated customers admit software only when they can see what it talks to and what data leaves, run it offline with named endpoints open, and keep verifying that this holds. The application also has to run in sandboxes and zero-trust networks, where network location grants no trust.

**Decision.**

- **Declare reach in the catalog.** Every destination, device and child process is declared with its purpose and data classes. Security manifests, data flows, control mappings and the SBOM are generated from the catalog and drift-checked like any other artifact.
- **The site binds declarations.** A site policy is data that binds declarations to addresses. Without one, the application runs isolated. Hardening profiles are floors: a deployment below its floor refuses to start rather than run weakened.
- **Enforce in two layers.** An in-process guard checks every connection the application makes. OS and orchestrator rules generated from the same policy cover what the guard cannot see. Code does not open connections or processes except through the guard.
- **Record inside the transaction.** A tamper-evident event log records actions, denials and connections. The record of a command is written in the same transaction, so by default a command that cannot be recorded does not commit. Startup resolves records a crash left open. Auditors read the log through ordinary authorized queries.

**Consequences.**

- Adding an integration means declaring its destination, and the reviewer sees it in the generated manifest diff.
- An unwritable log stops commands. A site that prefers availability must choose that explicitly, and stricter profiles refuse to.
- The in-process guard is not an isolation boundary. Containment comes from applying the exported rules or an OS sandbox.
- Workforce identity and certificate lifecycle are not implemented. Profiles that need them refuse to start instead of degrading.

**Alternatives considered.**

- An OS sandbox only: not portable, invisible to reviewers, and nothing to check at the application level.
- Writing the log outside the transaction: simpler, but it allows commits that were never recorded.
- Hand-written firewall documentation: drifts from the code.

# 005 — Declared egress, site policy and a fail-closed audit log

Accepted. Establishes [P11](../principles.md#p11--the-application-reaches-only-what-it-declares-and-the-site-binds-and-records-what-it-does) and strengthens P3 (identity floors) and P10 (generated, re-checked evidence). Code declares every network destination, device and child process it may use, as part of the composed catalog. A per-site policy file binds declarations to addresses. Nothing else is reachable. An injected, hash-chained event log records every business action, denial and connection, and by default a command does not commit if its audit record cannot be written.

**Context.** Industrial and regulated customers admit software only when they can see what it talks to and what data leaves, run it offline with named endpoints open, and keep checking that this stays true. The application also has to run in sandboxes and zero-trust networks, where location grants no trust.

**Decision.**

- **Declarations live in the catalog.** `requirements` on modules and `defineHostComponent` for host parts. The catalog build rejects an outbox target without a declared destination. The security manifest, data flows, control mapping and CycloneDX SBOM are generated from the catalog and drift-checked like the API contract.
- **The site policy is data.**
  - Without one, the app runs isolated.
  - Profiles (`desktop-local`, `sandbox`, `zero-trust`) are floors. Both `security check` and startup refuse a deployment below its floor; startup fails closed.
  - Identity is part of the floor. The trusted local owner is admitted only under `local-owner`, and `external` refuses to start until an identity adapter exists.
- **Enforcement has two layers.**
  - An in-process guard checks every connection the host makes: scoped fetch, socket and a CONNECT proxy for children.
  - OS and orchestrator rules (nftables, Windows Firewall, systemd, Kubernetes) are generated from the same policy and cover what the guard cannot see.
  - `check:boundaries` fails on direct network or process APIs outside the guard, except for a short, reasoned exemption list.
- **The event log is a runtime port.**
  - `command.accepted` is appended inside the transaction. In required mode a failed append rolls the command back.
  - Startup resolves accepted commands a crash left open.
  - Startup records the executable, catalog and policy digests.
  - A posture monitor re-verifies the chain while the app runs. Auditors read it through ordinary authorized queries.

**Consequences.**

- Adding an integration means declaring its destination and data classes. The reviewer sees the change in the generated manifest diff.
- An unwritable log stops commands. Sites that prefer availability must choose `best-effort` explicitly; sandbox and zero-trust refuse that setting.
- The guard is not an isolation boundary: real containment comes from applying the exported rules or an OS sandbox. No isolation backend ships here.
- A workforce identity adapter and certificate lifecycle remain open. Zero trust refuses to start without them instead of degrading.

**Alternatives considered.**

- An OS-level sandbox backend only: non-portable, invisible to reviewers, and with nothing to check at the application level.
- A log written outside the transaction: simpler, but it allows commits that were never recorded.
- Hand-written firewall documentation: drifts from the code.

See [security-and-assurance.md](../security-and-assurance.md).

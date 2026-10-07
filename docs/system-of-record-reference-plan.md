# Reference workflow implementation plan

Status: proposed extension to the implemented local kernel, following the task/workflow product framing. A quality-inspection reference now implements part of work packages 1–3 against an in-memory mock system; the [system-of-record reference](system-of-record-pattern.md) records which gates it meets. No sandbox broker, reconciliation state machine or fleet-update implementation is implied by this document. The [implementation ledger](implementation-status.md) records existing evidence; the [pattern](task-workflow-pattern.md) explains the intended architecture.

Use a **receiving observation** as the generic reference workflow. It is narrow enough to demonstrate optimized input and realistic enough to require another authority. This is a reference choice for the next implementation, not a claim about a particular customer's warehouse process or ERP API.

## Product slice

A worker selects or scans an expected delivery line, records the observed quantity and condition, and attaches permitted evidence for an exception. An agent can prepare or submit the same observation under a bounded grant. Ambiguous identity or interpretation becomes a question; a deterministic scan/confirm path needs no inference. The UI shows local capture immediately, then upstream acceptance or a recoverable exception as it arrives.

Use a deterministic mock system of record in a separate process with independent persistence and a fault-control API available only to tests. It owns expected delivery lines, upstream versions and accepted receipt records. The task app owns captures, delivery intents and authorized projections. Keep the existing project/task example as a small kernel conformance fixture until the new workflow passes its own gates.

## Work packages and acceptance

### 1. Define the bounded domain and interaction contract

Add a feature module under `examples/receiving` with contracts, handlers, policy, authored workflows and test fixtures. Define an ownership table before code: upstream delivery data, local observations, evidence metadata and external delivery results. Avoid copying a general inventory data model into the task app.

Proposed operations include querying an authorized delivery projection, capturing an observation, reading delivery status, cancelling an undispatched intent and resolving an exception. Internal claim/completion/ingestion operations require connector-service identity. They need explicit surface exceptions and must not appear as ordinary agent actions. Public discovery filters remain separate from enforcement.

Define stable event IDs, quantity units, timestamps and provenance, immutable submission content, distinct local/upstream versions, expected-revision behavior and evidence access. Define who may observe, submit, inspect evidence and reconcile each site/object; project rows and fields before pagination and counts.

Enforce event identity across principals, surfaces and harness attempts at the domain boundary, while authorizing each submission and its projected response independently. Scope that identity to the tenant, connector and target; maintain separate command keys and attempt IDs. The current runtime's run-sensitive receipt fingerprint cannot provide this business deduplication by itself.

**Acceptance:** human, agent and job invocations produce the same capture and authorization decisions. Submitting the same event through UI and MCP creates one delivery intent even across runs; a changed-payload replay conflicts, and an unauthorized replay discloses no protected result. Invalid quantities, inaccessible upstream objects and forged provenance are rejected. Schema/API/MCP/docs/skill outputs agree with the catalog. The generated surface remains useful without exposing internal completion powers.

### 2. Implement local intent durability and the connector port

Introduce a reusable delivery module/port separate from `Storage<State>` and from provider harnesses. Compose it into feature state explicitly; keep receiving-specific payloads out of the framework runtime. Store the capture, immutable intent, local receipt and change-journal entry in one existing transaction. Inject a connector registry at the host composition root.

The connector contract must describe target identity, supported operations, upstream revision checks, idempotency scope/retention, safe rejection categories, uncertain outcomes, reconciliation queries and capability/version compatibility. Model transport acknowledgement separately from business acceptance. Worker claims have attempt identities, expirations and fencing tokens so a stale worker cannot overwrite a newer completion. A claim timeout is not evidence that a remote write did not occur.

Fencing local writes cannot stop an old worker from issuing a delayed external request. Preserve late attempt evidence through a constrained ingestion path, without stale status overwrite. Redispatch requires upstream idempotency or proof the previous attempt can no longer cause an effect; absence from a reconciliation lookup alone does not supply that proof.

Dispatch outside the transaction using narrowly scoped host/broker credentials. Revalidate current dispatch permission and consent requirements at the last local gate; document the remaining upstream authorization race. A trusted completion command may record a previously dispatched result after user revocation, but cannot initiate another external effect. Completion and imported upstream changes go through runtime commands and `ctx.change`, preserving authorization and reactive delivery.

Cancellation succeeds as “cancelled before dispatch” only while the intent is still unclaimed. Once claimed, stopping a worker does not prove absence of an external effect; reconcile it. Keep reversal operations distinct. Treat upstream errors and data as untrusted input with validated, caller-safe error mappings.

**Acceptance:** crash before local commit creates neither capture nor intent; crash after commit preserves pending work; two workers cannot independently authorize a new attempt from the same claim; duplicate completions are harmless; changed payloads conflict. Kill the worker after remote acceptance but before local completion, then recover without duplicating the upstream record. Exercise both a stable-idempotency connector and a connector that requires reconciliation instead of blind retry. Revoke queued dispatch and verify that an already-dispatched result can still be recorded without exposing it to a revoked reader.

Pause worker A before external dispatch, expire its claim, start recovery with worker B, then resume A: verify that recovery uses the connector's external guarantees and that late evidence is retained without stale state replacement. Also acknowledge a request before its business result is known, then separately confirm and reject it in two scenarios. Every surface must show upstream-pending until the definitive result arrives.

### 3. Build the specialized UI and bidirectional updates

Create a receiving screen in the shared web/desktop frontend: delivery lookup/scan input, quantity and condition capture, exception evidence, confirmation and visible delivery status. Use typed capabilities; retain editable drafts separately from committed state. Keep keyboard/scanner operation deterministic. Do not claim physical-device support until checked on that device.

Expose a constrained UI selection/revision context to agent runs. The agent can request a clarification and hand back a prepared draft; final capture uses the same domain command as the direct UI. Render queue/rejection/reconciliation states in product language and give the user an actionable exception route.

Add a mock upstream change feed or polling adapter. Persist a checkpoint only with its projection changes; handle duplicate/out-of-order updates using upstream versions. A gap or expired cursor requires reconciliation. State the freshness of the local projection and its authorization information. Imported changes must invalidate open views through the same journal, including revocation and object removal.

**Acceptance:** separate UI, CLI/MCP, agent and connector processes converge without refresh. Test a dirty draft against an upstream version change, a disconnected connector, replayed/out-of-order feed messages, a revoked object and a pending observation after restart. An out-of-band upstream edit prevents a stale conditional write even before the local projection catches up. External receipt state and local journal state remain distinguishable. A backend-only test is insufficient for this gate: demonstrate the visible status transitions and draft behavior in a browser.

### 4. Add the bounded execution host and tool broker

Design an execution-host port separately from the existing harness port. The harness chooses and coordinates tools; the execution host enforces the declared process/filesystem/network/resource profile. Implement one actual isolation backend before claiming executable-code containment, with a documented supported OS and threat boundary. Leave unsupported backends explicitly unsupported rather than silently running unrestricted.

Broker sessions bind principal, workspace, run, expiry, allowed operations/resources and destinations. Keep raw upstream and unrestricted authority credentials outside the sandbox. Provide wrappers that let approved CLIs and MCP servers invoke catalog capabilities through this broker. Resolve tool executables by an approved package manifest/version; shell composition must not introduce an unrestricted alternate write path. Bound output size and treat returned text as untrusted data.

Demonstrate both CLI composition and MCP access from the sandbox. The fixture should perform a useful two-step task, such as looking up a delivery and submitting an observation. Do not give the sandbox direct database access, a container-management socket or a generic privileged network proxy. A remote sandbox changes data residency and connectivity assumptions and must be an explicit deployment choice.

**Acceptance:** permitted composition succeeds, while forbidden file/process/network access, undeclared tools, expired grants and cross-object calls fail under the actual isolation backend. Test broker revocation and teardown, output limits and attempts to bypass the broker. Verify business effects through receipts and upstream evidence, independent of harness narration. Provider protocol fixtures alone do not establish these results.

### 5. Package the task on a maintained host

Define a versioned task-package manifest: UI entrypoint, module/contract versions, workflows, connector requirements, requested tool profile/permissions, supported host versions and migrations. It declares requirements; the deployment owner authorizes them. Never allow package updates to expand permissions silently.

Choose one packaging route using the existing desktop host or a managed web host. Build immutable signed packages, verify them before loading executable content, and stage activation through explicit compatibility checks. Store data and delivery queues outside the package. Run pending intents against their recorded contract/connector semantics; incompatible work blocks activation or enters a deliberate migration path. Rolling back code must not blindly roll back acknowledged business records.

Demonstrate an upgrade with pending work and a rollback-compatible path. Define package disablement, recovery access, audit correlation and operational ownership. A full fleet service can remain separate, but its deployment/health/rollback contract and operational costs must be documented.

**Acceptance:** reject tampered/incompatible packages and undeclared privilege expansion; preserve pending intents across restart/update; retain a way to reconcile after package disablement; test failed migration recovery. State separately whether signatures, staged updates and rollback ran on an actual packaged host.

### 6. Verify the workflow and publish reproducible evidence

Use deterministic connectors and harness fixtures in CI for reproducible fault and permission tests. Keep real provider inference, real device input and real enterprise API integration as separate configured checks. Extend the setup skill with the implemented recipes only after the feature and isolation gates pass.

Record capture-to-acceptance time, user input time, retries, duplicate prevention, reconciliation effort, permission failures and inference usage. A lab demonstration can prove correctness and measure interaction mechanics; productivity, adoption and license savings require a deployment baseline and observed task volumes. Avoid presenting synthetic timings as industrial field results.

**Acceptance:** a reviewer can run the workflow, inject upstream acceptance-with-lost-reply, see recovery in the UI and inspect matching command/intent/attempt/upstream identifiers. Docs state the tested OS, connector semantics, trust boundary and live-integration gaps. The showcase tells one complete task story and provides reusable modules rather than customer-specific infrastructure.

## Sequencing and review ownership

Agree the feature, connector and delivery-state contracts first. Then separate implementation ownership for the domain/delivery module, mock connector/fault tests, and UI/transport scenarios. The execution-host/broker work can proceed against that contract independently; package activation follows a working slice. Root owns dependency manifests and integration changes. Keep each worker's file ownership disjoint and assign a different reviewer to its transaction, authorization and failure-path tests.

Treat every acceptance gate as evidence for that scope, not as a blanket production-readiness claim. The original local kernel checks remain regression gates; do not replace them with a successful receiving demo.

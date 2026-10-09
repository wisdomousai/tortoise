# Reference workflow plan

Status: proposed. It extends the local kernel along the [task/workflow pattern](task-workflow-pattern.md). The quality-inspection reference already covers part of packages 1–3 against an in-memory mock, and the [system-of-record pattern](system-of-record-pattern.md#status-against-the-reference-plan) records which gates it meets. The operator workstation pattern adds held effects, which a person resolves. Nothing here implies that a sandbox broker, general reconciliation with worker claims, or fleet updates exist.

The proposed reference workflow is a **receiving observation**. It is narrow enough to show optimized input, and realistic enough to need another authority. This is a reference choice, not a claim about any customer's warehouse or ERP.

## Product slice

A worker scans an expected delivery line, records quantity and condition, and attaches evidence for an exception. An agent can prepare or submit the same observation under a bounded grant. Ambiguity becomes a question, and the scan-and-confirm path needs no model. The screen shows the local capture at once, then upstream acceptance or a recoverable exception.

A deterministic mock system of record runs in its own process, with its own persistence and a fault-injection API for tests. It owns delivery lines, upstream versions and accepted receipts. The task application owns captures, intents and projections.

## Work packages

Each package lists its goal and what has to be shown before it counts as done.

### 1. Bounded domain and contract

**Goal.** Before any code, define an ownership table, stable event IDs, units, timestamps, provenance, immutable submissions, separate local and upstream versions, and evidence access. Define who may observe, submit, inspect and reconcile. Connector-only operations, such as claim, complete and ingest, are declared surface exceptions, not agent actions. Event identity holds across principals, surfaces and runs, at the domain boundary, separately from command idempotency keys.

**Acceptance.**

- People, agents and jobs get the same captures and decisions.
- The same event submitted from the UI and from MCP creates one intent, even across runs.
- A changed payload conflicts, and an unauthorized replay reveals nothing.
- Invalid quantities, inaccessible objects and forged provenance are rejected.
- The generated surfaces agree with the catalog.

### 2. Durable intents and the connector port

**Goal.** Add a reusable delivery module, separate from storage and harnesses, that stores capture, intent, receipt and journal entry in one transaction. The connector contract covers target identity, operations, upstream revision checks, idempotency scope, safe rejection categories, uncertain outcomes, reconciliation queries and version compatibility. Acknowledgement is distinct from acceptance. Worker claims carry attempt IDs, expiry and fencing, and a timed-out claim is not proof that nothing happened. Redispatch needs upstream idempotency or proof that the earlier attempt can no longer take effect. Cancellation succeeds only before a claim. Upstream errors and data are untrusted input.

**Acceptance.**

- A crash before commit leaves nothing, and a crash after commit keeps the pending work.
- Two workers cannot both attempt from one claim, and duplicate completions are harmless.
- A worker killed after remote acceptance recovers without a duplicate upstream record.
- Both an idempotent connector and one that needs reconciliation are exercised.
- After revocation, an already-dispatched result can still be recorded without exposing it to a revoked reader.
- A paused worker that resumes after recovery leaves its late evidence retained but cannot replace the current state.
- A result that is acknowledged now and decided later shows upstream-pending until it is decided.

### 3. Specialized UI and two-way updates

**Goal.** A receiving screen covers scan or lookup, quantity and condition, exception evidence, confirmation and visible delivery status. Drafts stay separate from committed data, and keyboard and scanner use is deterministic. An agent can ask for clarification and hand back a draft, while final capture uses the same command. A change feed or polling adapter stores its checkpoint with the projection and handles duplicate and out-of-order updates by upstream version. A gap triggers reconciliation, and imported changes, including revocations and removals, update open views.

**Acceptance.**

- UI, CLI, MCP, agent and connector processes converge without a refresh.
- The suite covers a dirty draft against an upstream change, a disconnected connector, out-of-order messages, a revoked object, and a pending observation across a restart.
- An out-of-band upstream edit blocks a stale conditional write.
- These transitions are shown in a browser, not only in backend tests.

### 4. Execution host and tool broker

**Goal.** An execution-host port, separate from the harness port, enforces a declared profile for processes, files, network and resources. Ship one real isolation backend with a documented platform and threat boundary before claiming containment. Broker sessions bind principal, workspace, run, expiry, operations, resources and destinations, and upstream credentials stay outside the sandbox. Approved CLIs and MCP servers reach the catalog only through the broker. The sandbox gets no direct database access, no container socket and no general proxy.

**Acceptance.**

- A useful two-step task succeeds both by CLI composition and through MCP.
- Forbidden file, process and network access, undeclared tools, expired grants and calls on other objects fail under the real backend.
- Revocation, teardown, output limits and attempts to bypass the broker are tested.
- Effects are verified through receipts and upstream evidence, not through the harness's narration.

### 5. Packaging on a maintained host

**Goal.** A versioned package manifest declares the UI, contract versions, workflows, connector needs, requested permissions, host compatibility and migrations, and the deployment owner approves them. Packages are signed, verified before loading, and activated in stages. Data and queues live outside the package, pending intents keep their recorded semantics, and a rollback never rolls back acknowledged records.

**Acceptance.**

- Tampered or incompatible packages are rejected, and so is silent privilege expansion.
- Pending intents survive restarts and updates, and reconciliation stays possible after a package is disabled.
- A failed migration recovers.
- Signing, staging and rollback are reported separately for a real packaged host.

### 6. Evidence

**Goal.** Deterministic connectors and fixtures in CI cover faults and permissions, while real inference, real devices and real APIs are separate configured checks. Measure capture-to-acceptance time, input time, retries, duplicates prevented, reconciliation effort, permission failures and inference use. Synthetic timings are never presented as field results.

**Acceptance.**

- A reviewer can run the workflow, inject an acceptance whose reply is lost, see recovery on screen and match the identifiers end to end.
- The docs state the tested platform, the connector semantics, the trust boundary and the live gaps.

## Sequencing

Agree the domain, connector and delivery-state contracts first. Domain and delivery, the mock connector with fault tests, and UI and transport scenarios can then proceed in parallel, with disjoint ownership and an independent reviewer for transaction, authorization and failure paths. The broker can follow the contract on its own, and packaging follows a working slice. Each gate is evidence for its own scope, not for production readiness, and the existing kernel checks stay as regression gates.

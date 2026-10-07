# Principles

Each principle is an architectural invariant that a design either keeps or breaks. **Rules out** names what a violation looks like. **Enforced by** names the checks and tests that fail when the invariant breaks, and marks what is still **convention only**, kept by authors and reviewers. The building blocks that deliver each principle are explained in [primitives](primitives.md).

Mechanism detail lives in the [architecture](architecture.md), [interaction contract](interaction-contract.md), [authorization](authorization.md), [state and reactivity](state-and-reactivity.md), [system-of-record](system-of-record-pattern.md) and [operator workstation](operator-workstation-pattern.md) documents and the [decision records](decisions/).

### P1 — Every operation is executable from UI, MCP, CLI and API

Each operation has one handler. Every surface reaches it with the same validation, authorization, result and structured error, so a scenario passes or fails identically on all of them. A surface that intentionally lacks an operation declares the exception, and composition rejects an undeclared gap. Interaction may be specialized per surface while meaning stays fixed: a scan, a hold-to-confirm button, a CLI flag and an agent's tool call all submit the same command. An agent is one more caller on these surfaces, not a separate layer with its own actions.

**Rules out:** UI-only endpoints, agent-only tools, admin scripts that write the database, business logic inside a transport or component.

**Enforced by:** catalog validation rejects an operation without a UI binding or declared exception (`packages/contracts/test/contracts.test.ts`); the same scenarios run through direct, HTTP, CLI subprocess and MCP and must agree (`packages/testing/test/transport-conformance.test.ts`, `inspection-conformance.test.ts`, `station-conformance.test.ts`). **Convention only:** that a UI binding declaration is actually rendered; browser specs cover the reference screens, not every operation.

### P2 — The catalog is the only description of what the application can do

Modules contribute capabilities to one composed catalog. The UI bindings, MCP tools, CLI subcommands and flags, OpenAPI, JSON Schema, operation reference and application skill are all generated from it. Generation is pure: it opens no workspace, reads no credential and starts no server, which requires contracts to be browser-safe data separate from handlers. Generated artifacts are checked in and drift fails the build.

**Rules out:** hand-maintained tool lists, API docs or schemas; contracts that import handlers, drivers or provider SDKs; runtime discovery as the source of types.

**Enforced by:** `bun run check:generated` fails on drift between the catalog and every generated artifact; `bun run check:boundaries` keeps contracts and browser code free of handlers, drivers and provider SDKs; catalog validation rejects duplicates, cycles, unresolved workflows and colliding MCP names (`packages/contracts/test/contracts.test.ts`).

### P3 — Authority comes from trusted context, never from input, and is enforced at commit

The host derives principal, workspace and grant; operation input cannot select or widen them. Policy decides operation, object, row and field access. Rows are scoped before filtering, pagination and counts. Authorization, grants and cancellation are rechecked inside the transaction and again before commit. Delegation only narrows, approval never elevates, and provider credentials grant no workspace access. Replays and event delivery are authorized against current policy, and anything unknown fails closed.

**Rules out:** role or principal fields in operation input, checks only at the edge, counts that leak hidden rows, cached decisions reused after revocation.

**Enforced by:** `packages/testing/src/security-conformance.test.ts` (grants constrain rows, replay and events; interruptions cannot commit or leak); the role matrices in each `examples/*/domain.test.ts`; `packages/adapters/src/casl.test.ts` (scope agreement across CASL, memory and SQL, fail-closed rules); `packages/runtime/test/runtime.test.ts` (current authorization governs retries).

### P4 — Every write is a command to the single authority of its workspace

One authority owns each workspace. UIs, tools, jobs, connectors and observers submit commands; none opens a second writable copy. A command commits feature state, resource revisions, its idempotency receipt, journal entries and outbox effects atomically, or nothing. Retries with the same key return the stored result; stale revisions conflict; a mutation that declares no changed resource fails. No network or model call runs while a transaction is held.

**Rules out:** direct database writes, dual writers, write-then-notify sequences that can lose the notification, side effects inside a transaction.

**Enforced by:** `packages/runtime/test/runtime.test.ts` (undeclared changes cannot commit, expected revisions cannot lose updates, scoped idempotency); `packages/testing/test/storage-conformance.test.ts` (memory and SQLite commit state, receipts and outbox atomically); `packages/adapters/src/sqlite.test.ts` (a rolled-back transaction leaves the initial-state factory untouched); `packages/adapters/src/ownership.test.ts` (one owner per workspace). **Convention only:** that no new code path writes state outside a handler.

### P5 — Every committed change reaches every authorized view, whatever its origin

A change committed by a person, an agent, a job or an inbound sync flows through the same journal to every subscribed screen and tool the caller may see, without refresh. Queries return a snapshot with a cursor so subscription closes the race. Delivery is filtered by current permissions, and an authorization change resets views without leaking identifiers. Unsaved drafts survive external updates and conflict explicitly instead of being overwritten.

**Rules out:** polling as the consistency model, per-surface caches that miss other surfaces' writes, event payloads carrying protected record contents.

**Enforced by:** `packages/client/src/client.test.ts` (snapshot cursor closes the subscription race, revocation resets, stale responses are fenced); `packages/testing/test/direct-transport.test.ts` (the in-process transport resets after a revocation between snapshot and subscription, and never lifts launcher cancellation); `packages/react/src/bindings.test.ts` (dependency-indexed refetch, permission change clears cache); `tests/e2e/workspace.pw.ts` and `inspection.pw.ts` (an external write appears without refresh, drafts survive).

### P6 — Status reports what is known, not what is hoped

Draft, committed, dispatched, accepted, rejected and uncertain are distinct states that every surface can show. A receipt is not upstream acceptance, a stream of text is not a commit, and an exit code is not a delivery outcome. Observed values carry source, confidence and age, and only stable readings become current. An uncertain outcome is held for a person to resolve, never guessed or blindly retried.

**Rules out:** optimistic "done" before acceptance, inferring success from narration, silently overwriting state with a low-confidence reading.

**Enforced by:** `packages/runtime/test/outbox.test.ts` and `packages/integration/test/held.test.ts` (delivery states, uncertain outcomes held, not resent, including when shutdown interrupts delivery); `packages/station/test/observer.test.ts` (only stable readings become current, unsure readings stay uncertain); `packages/agents/test/supervisor.test.ts` (run state separate from commits). **Convention only:** that every screen and tool shows the delivery state rather than a receipt.

### P7 — Other systems are reached only through durable intents

Systems of record keep ownership of their records. A command commits an intent with its local change; a connector delivers it outside the transaction, at least once, relying on the target's idempotency or a lookup before resending. A narrowly granted integration principal records outcomes and imports upstream changes through ordinary commands. The contract is the same whether the target is an API, a file drop or legacy software reachable only through its screen.

**Rules out:** calling a remote system from a handler, distributed transactions, connectors that hold business tools, retrying an unknown outcome as if it failed.

**Enforced by:** `packages/runtime/test/outbox.test.ts` (effects commit with the command, replay never re-enqueues); `packages/integration/test/dispatcher.test.ts` (delivery outside the transaction, lookup before resend, integration grant limits, watermark-bound sync); `packages/station/test/controller.test.ts` (gate, readback, uncertain procedures held); lane separation in `station-conformance.test.ts`.

### P8 — Specialization is composition and configuration, never a fork

The framework packages are domain-neutral. Domains live in modules and examples, composed explicitly with their own state slice and routed policy; a domain concept becomes a primitive only when a second application needs it. What differs per site (station profiles, scanner profiles, scan routes, connector mappings) is versioned, schema-validated data, gated by a replayable check where it drives perception or actuation. Reusable UI ships as shadcn registries composed from stock primitives.

**Rules out:** domain names in `packages/*`, customer forks, site logic in code, forked or hand-styled UI primitives.

**Enforced by:** `bun run check:boundaries` rejects imports from `packages/*` into `examples/` or `apps/`; `packages/runtime/test/compose.test.ts` (modules see only their slice, unrouted operations fail closed); `packages/station/test/profile.test.ts` and `bun run station:golden` (profiles validated and gated); `bun run check:registry:operator` (registry manifest drift). **Convention only:** that package code names no business domain, and the second-application promotion rule.

### P9 — Every external dependency sits behind a port

Storage, policy, identity, transport, agent harness, inference, system-of-record connector, screen transport, perception and device input each enter through a port with documented guarantees and a conformance suite. Vendor SDK types stay inside their adapters, and the core takes no cloud-platform dependency. Replacing an adapter changes no contract or handler.

**Rules out:** provider types in contracts, storage assumptions in handlers, a model or vendor that cannot be swapped without touching domain code.

**Enforced by:** `packages/testing/test/storage-conformance.test.ts` (memory and SQLite give identical outcomes); `bun run check:boundaries` keeps provider SDKs and host runtimes out of browser code; harness adapters pass shared fixtures (`packages/agents/test/adapters.test.ts`). **Convention only:** that vendor types stay inside adapters and the core takes no cloud dependency.

### P10 — A claim is only as strong as its evidence

Every operation has behavioral scenarios that run through each surface it supports. Deterministic, browser, native, device and live-provider evidence are recorded separately, and a capability is not called supported until it has run on the real thing. Changes to perception or site configuration pass a golden check before activation. Productivity figures come from measured task runs, labeled synthetic until measured in the field.

**Rules out:** calling a mock-tested adapter live, a single blended pass/fail, undocumented drift between docs and code.

**Enforced by:** the implementation ledger records deterministic, browser, native, device and live-provider evidence separately; `bun run test:sandbox`, part of `bun run check`, compiles the binary with the shipped build configuration and runs it with an empty environment. **Convention only:** most of this principle is review discipline; no tool can tell a mocked pass from a live one.

## Keeping this current

Principles change rarely and on purpose. The [primitives](primitives.md) document changes whenever a public building block does. [AGENTS.md](../AGENTS.md#principles-and-primitives) gives the working rules.

- **Add** a principle only for an invariant none of the existing ones covers. Significant decisions also get a record in `docs/decisions/` that names the principle.
- **Amend** a principle through an explicit edit with a changelog line. Do not work around one in code. If a change needs to break a principle, stop and raise it.
- **Retire** a principle by replacing its body with `Retired: <reason>; see Pn.` Its ID stays reserved.
- When a check or test starts or stops enforcing a principle, update its **Enforced by** line. Turning convention into enforcement is the preferred way to strengthen a principle.

## Changelog

- 2026-10-07 — Replaced each principle's primitive list with what enforces it; primitives name their principles in one place.
- 2026-10-07 — Rewritten as ten architectural invariants, each with what it rules out and the primitives it requires. Replaces the same-day drafts before anything external cited them.
- 2026-10-07 — First draft from the implementation plan invariants, ADRs 001–004 and the pattern documents.

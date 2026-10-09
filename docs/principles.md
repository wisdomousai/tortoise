# Principles

These are the design commitments that keep the architecture coherent. They are guidance, not law: each states an intent and why it matters, so a change can be judged against the intent rather than the wording. A change that departs from a principle says so and why. When departures keep coming for the same reason, the principle is rewritten.

**Checked by** names the checks and suites that catch the common ways of breaking a principle. It points at suites, not at every test, and it never covers everything; review covers the rest. The building blocks behind each principle are in [primitives](primitives.md), mechanisms in [architecture](architecture.md) and the topic guides, and the reasoning behind larger choices in the [decision records](decisions/).

### P1 — Every operation is reachable from every surface

Each operation has one handler. The UI, MCP, the CLI and HTTP reach it with the same validation, authorization, results and errors. People, agents, scripts and devices are callers of the same operations, so whatever one can do, another can do with the same rights. Surfaces may present an operation differently, such as a scan, a button, a flag or a tool call, but its meaning stays fixed. A surface may leave an operation out if it says so.

**Why:** there is no hidden admin path and no agent-only action, and a behavior tested on one surface holds on the others.

**Checked by:** catalog validation, which requires a UI binding or a declared exception; the transport conformance scenarios in each example; the UI-binding test.

### P2 — The catalog describes the application

Modules contribute capabilities to one composed catalog. Every surface and reference artifact is generated from it, including tool lists, CLI flags, schemas, API descriptions and agent skills. Contracts are data, kept separate from the code that executes them, so generation opens no workspace and needs no credentials.

**Why:** a description that is generated cannot drift from what runs.

**Checked by:** `check:generated` (drift) and `check:boundaries` (contracts stay free of executable code); catalog validation.

### P3 — Authority comes from trusted context

The host establishes the principal, workspace and grant, and operation input cannot choose or widen them. Policy decides access to operations, objects, rows and fields, and rows are scoped before they are counted or paged. Access is checked again where it takes effect: at commit, on replay and on event delivery. Delegation only narrows, approval never elevates, and anything unknown is denied.

**Why:** callers include agents acting on someone's behalf, so authority must not depend on what a caller says about itself.

**Checked by:** the security conformance and role-matrix suites in the examples; the runtime, policy-adapter and hardening suites.

### P4 — Each workspace has one writer

One authority owns each workspace, and every write is a command to it. A command commits its state, revisions, receipt, journal entries and outbound effects together, or none of them. Retries return the stored result, and stale revisions conflict. Network and model calls happen outside the transaction.

**Why:** with one writer and atomic commits, every reader and every integration agrees on what happened.

**Checked by:** the runtime suites and the storage conformance suite.

### P5 — Committed changes reach every authorized view

A change reaches every screen and tool that may see it, without a refresh. This holds whether a person, an agent, a job or a sync made the change. Reads return a snapshot with a cursor, so subscribing cannot miss a change. Delivery follows current permissions. Unsaved drafts conflict explicitly instead of being overwritten. Answers read from another system are point-in-time and say so.

**Why:** people and agents work on the same records at once and need to see each other's work.

**Checked by:** the client and React binding suites; the browser specs.

### P6 — Status says what is known

Draft, committed, dispatched, accepted, rejected and uncertain are distinct states, and every surface can show them. A receipt is not acceptance, and narrated progress is not a commit. Observed values carry their source, confidence and age. An outcome that is not known is held for a person to resolve, never guessed or blindly retried.

**Why:** decisions about physical work and other systems depend on knowing what actually happened.

**Checked by:** the outbox, held-delivery, observer and run-supervision suites.

### P7 — Other systems change only through durable intents

Systems of record keep ownership of their records. A command commits an intent together with its local change. A connector delivers the intent outside the transaction, at least once, and relies on idempotency or a lookup before resending. Outcomes and upstream changes come back through ordinary commands. Reading another system is a declared query, made outside any transaction with the caller's own credential, and nothing it finds is stored. Bringing a found record in is a command.

**Why:** local work never blocks on another system, and nothing is written there that the application cannot account for.

**Checked by:** the outbox, dispatcher, remote-query and remote-source suites.

### P8 — Specialize by composition and configuration

Domains live in modules composed into an application, and the framework names no domain. Site differences are versioned, validated data, gated by a replayable check where they drive perception or actuation. A concept moves into the framework once a second application needs it. Reusable UI is built from stock primitives and shipped as registries.

**Why:** a fork stops receiving improvements, and code written for one domain does not fit the next.

**Checked by:** `check:boundaries`; the composition and station profile suites; the registry drift check. Domain-neutrality of names is left to review.

### P9 — External dependencies sit behind ports

Storage, policy, identity, transports, agent harnesses, inference, connectors and devices each enter through a port with stated guarantees. Vendor types stay inside their adapters, and the core takes no dependency on a cloud platform.

**Why:** adapters change more often than the domain, and sites differ in what they run.

**Checked by:** the storage and harness conformance suites; `check:boundaries` for browser code.

### P10 — Claims follow evidence

A capability is called supported only when it has run where the claim applies. Deterministic, browser, native, device and live-provider evidence are recorded separately. Changes to perception or site configuration pass a golden check before they take effect. Productivity figures are labeled synthetic until they are measured.

**Why:** a reference architecture is only useful if what it says works does work.

**Checked by:** the [implementation status](implementation-status.md) ledger; the sandbox binary run; `check:readmes`. Telling a mocked pass from a live one is left to review.

### P11 — Layers depend inward, and an authority runs one application

The framework (`packages/*`) is domain-neutral. Plugins (`plugins/*`) add cross-cutting concerns that an application chooses to compose. The starter (`apps/*`) is wiring its owner forks and extends. Content (`examples/*`, or the owner's modules) implements framework contracts. Each layer depends only on the layers beneath it. The starter learns which application to run from configuration. One running authority serves one application, with its own catalog, artifacts, workspace and screens ([ADR 005](decisions/005-framework-shell-content.md), [ADR 010](decisions/010-host-plugins.md)).

**Why:** a forked starter keeps receiving framework changes, and applications cannot leak into each other.

**Checked by:** `check:boundaries`; the host plugin suite; the single-example scaffold export.

### P12 — Applications run beside the work

An application runs on or beside the machine where the work happens, together with its connectors, observers and agents. A command commits locally and never waits for a system of record, a wider network or a model. Every task keeps a path that needs no inference: models propose, and deterministic code acts. Endpoints are explicit configuration ([ADR 006](decisions/006-edge-placement.md)).

**Why:** plant networks are segmented and links fail, but work at the machine has to continue.

**Checked by:** the dispatcher and sandbox suites; the deterministic browser path. Disconnected operation has not been exercised on a device.

### P13 — Declared reach, recorded actions

An application declares every destination, device and child process it may use, with its purpose and data classes. The site decides what those declarations bind to. Nothing undeclared is reachable, and with no site configuration nothing outside the host is reachable at all. What the application does is recorded in a tamper-evident trail, and by default a command that cannot be recorded does not commit. Configuration that would go unenforced refuses to start instead of looking enforced. The evidence an auditor checks is generated from the same declarations ([ADR 007](decisions/007-declared-egress-and-audit-log.md)).

**Why:** regulated and industrial sites admit software only when they can see and verify what it reaches.

**Checked by:** catalog validation of requirements; `check:boundaries` for direct network and process APIs; the egress, event-log, audit, host-plugin and hardening suites; `test:isolated`; `check:generated`. Device access is declared but not mediated.

### P14 — One reason to change per module

A file, factory or component does one job, and its name says which. A factory composes collaborators that receive their dependencies explicitly instead of sharing closure state. Barrels only re-export ([ADR 008](decisions/008-module-size-and-cohesion.md)).

**Why:** reviewers and agents can read and change one responsibility at a time.

**Checked by:** `check:size`, a tripwire on file and function size and on barrels. Whether a split follows responsibility is left to review.

## Keeping this current

Principles change rarely, and when they do the change is deliberate. When a change departs from one, the change says so. If the departure is general, rewrite the principle in the same change and add a changelog line. Record a larger decision in `docs/decisions/`. Retire a principle by replacing its body with `Retired: <reason>`; its number stays reserved.

## Changelog

- 2026-10-09 — Rewritten as guidance: each principle states its intent and why, **Checked by** names suites rather than test files, and mechanism moved to the guides and ADRs. Earlier history is in git.

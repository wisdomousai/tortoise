# Principles

These principles explain why the framework has the shape it has. Each one is a commitment that code, documentation and examples must honor. The [primitive catalog](primitives.md) lists the reusable building blocks that realize them, and every primitive cites the principles it serves.

Sources: the architectural invariants in [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md#2-architectural-invariants), the [decision records](decisions/), the [task/workflow pattern](task-workflow-pattern.md), the [system-of-record reference](system-of-record-pattern.md) and the [operator workstation pattern](operator-workstation-pattern.md). When a principle and a detailed document disagree, fix one of them in the same change.

IDs are permanent. Retire a principle by marking it retired and saying what replaced it; never renumber. See [keeping this current](#keeping-this-current).

## Contract

### P1 — Define a capability once; every surface is a projection

A business behavior is one capability: a stable ID, schemas, a permission requirement and declarations. The UI, HTTP, MCP, CLI, OpenAPI, operation docs and the application skill all derive from the composed catalog. No surface keeps its own operation list or reimplements behavior. Parity means the same business meaning, authorization and observable outcome. It does not require identical interaction: a scan, a large button and structured tool arguments can all submit the same command.

### P2 — Contracts are pure, portable data

Contracts are browser-safe and serializable. They never import handlers, storage drivers, provider SDKs or React components. Wire values are strict JSON. Generating artifacts opens no workspace, loads no credential and starts no server. Executable handlers, UI and scenarios are separate entrypoints.

### P3 — Compose explicitly, fail before startup

Modules, handlers, ports and policies are registered explicitly at a composition root. There is no filesystem discovery and no global registration side effect. Validation rejects duplicate IDs, missing or cyclic dependencies, unresolved workflow references and missing UI declarations before the service runs. A surface omission is a documented exception, not a silent gap.

## Authority

### P4 — One write authority; every business write is an authorized command

Each workspace has exactly one authority. UIs, agents, jobs, connectors and observers submit commands to it. None of them writes feature state directly or opens a second writable copy. Transports adapt requests and nothing more.

### P5 — Authority comes from trusted context, never from arguments

The host derives the principal, workspace and delegation grant. Operation input cannot select or widen them. Identity establishes a principal, policy grants permissions, delegation only narrows, and an approval never elevates a denied action. Provider credentials fund inference and grant no workspace access. Secrets stay outside browser state, domain data, model context and logs.

### P6 — Authorize every level, at the moment of commit

Check the operation, the actual object, the rows and the fields. Scope rows before filtering, pagination and counts. Recheck authorization, grants and cancellation inside the transaction and again before commit. Replays and event delivery are authorized against current policy. Unknown operations, unsupported policy conditions and unavailable engines fail closed.

## State and delivery

### P7 — A commit is atomic and observable

Feature state, resource revisions, the idempotency receipt, journal entries and outbox effects commit together or not at all. A mutation that declares no changed resource fails instead of becoming an invisible write. Every commit, whatever its origin, reaches authorized subscribers through one journal. No model or network call runs while a transaction is held.

### P8 — State is honest about what is known

Keep distinct what was drafted, committed, dispatched, accepted upstream, observed and inferred. A receipt is not upstream acceptance. Streamed text is not a commit. A process exit code is not a delivery outcome. Observed values carry provenance, confidence and age. Uncertainty is shown as uncertainty, never resolved by guessing. Drafts stay separate from committed data.

### P9 — Other authorities are reached through the outbox

Systems of record keep ownership of their records. The application commits a durable intent and a connector delivers it outside the transaction, at least once, using the target's idempotency or a lookup. A narrowly granted integration principal records the outcome through an ordinary command. Inbound changes enter the same way. An uncertain outcome is held for reconciliation, never blindly retried. A screen-only station is a connector like any other ([ADR 004](decisions/004-screen-mediated-authority.md)): pixels are a transport, not a harness.

## Execution

### P10 — Models propose; deterministic code decides and verifies

A model may interpret, resolve a target or suggest the next action. Deterministic code validates and executes it behind a policy gate, and accepts the result only after a readback. Every task has a path that needs no model turn, such as a scan, a keypad entry or a direct command. Inference is a bounded, replaceable component, never the only way to act.

### P11 — Fit the point of work

The unit is a bounded task with a named trigger, inputs, completion condition and exception owner, not a general record manager. Design starts from the real event: what a person or agent can observe and must make attributable. At a station, scanner and keypad input come first. Targets are sized for gloves, consequential actions use hold-to-confirm, and state reads as icon plus text from a distance.

## Structure

### P12 — Primitives are domain-neutral; domains live in examples

`packages/*` never names a business domain. Everything that does (operations, lifecycle phases, fixtures, screens) lives in `examples/*` and the app shells. A domain concept becomes a primitive only when a second example needs it, and its gate is then proven on more than one example. Reusable UI ships as a shadcn registry built from stock primitives, with tokens and `cva` variants and no forked components.

### P13 — Ports, not platforms

Storage, policy, identity, transport, harnesses, connectors, screen transports and extractors sit behind ports with documented guarantees. Vendor SDK types stay inside their adapters. Framework contracts and the runtime take no cloud-platform dependency. A replacement adapter must pass the port's conformance suite.

### P14 — Site particulars are versioned, validated data

Whatever differs between installations is configuration: station profiles, scanner profiles, scan routes, connector mappings. It is versioned, validated against a schema and, where it drives perception or actuation, gated by a replayable golden check before activation. Forward deployment changes data and modules, not forks.

## Evidence

### P15 — Claims are scoped to their evidence

Deterministic tests, browser checks, native platform smoke tests, real-device checks and live provider runs are different kinds of evidence. Report them separately. Never call an adapter supported or live-verified because a mock passed. Generated artifacts are checked for drift. Synthetic timings are not field results.

## Keeping this current

Principles change rarely and on purpose. The [primitive catalog](primitives.md) changes whenever a public building block does. [AGENTS.md](../AGENTS.md#principles-and-primitives) gives the working rules, and `bun run check:principles` checks the cross-references.

- **Add** a principle when a design decision cannot be explained by an existing one. Significant decisions also get a record in `docs/decisions/` that names the principle.
- **Amend** a principle only through an explicit edit with a changelog line. Do not work around one in code. If a change needs to break a principle, stop and raise it.
- **Retire** a principle by replacing its body with `Retired: <reason>; see Pn.` Its ID stays reserved.

## Changelog

- 2026-10-07 — P1–P15 written from the implementation plan invariants, ADRs 001–004, the task/workflow, system-of-record and operator workstation patterns, and the package-split and registry conventions.

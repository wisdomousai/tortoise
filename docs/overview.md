# Overview

This repository is a TypeScript reference implementation for [edge applications](edge-applications.md): applications that run on or next to the machines where work happens, and that people and AI agents on the same machine operate together. A typical application runs scripts and procedures locally against control software, interprets the results locally, and reports them to a system of record (ERP, quality system, MES). Every operation is defined once and exposed to a desktop/browser UI, HTTP, MCP and a CLI, so a person, a local agent harness, a script or a device calls the same operation with the same validation and authorization.

It contains a domain-neutral framework (`packages/*`), host plugins for security, assurance and an example webhook (`plugins/*`), a thin starter that hosts one application (`apps/*`), and three example applications (`examples/*`). It is a reference to read, run and export with the scaffolder; it is not a published library or a hosted service.

## Purpose

Systems of record own enterprise data, but their standard interfaces are built for general record management. Repetitive capture tasks fit them poorly: a goods receipt, an inspection result or a machine stop reason is a few fields per event, entered under time pressure, often with a scanner. There are two common fixes, and both cost a lot. Customizing the system of record is a software project that has to be redone on vendor upgrades. A separate application per site or task has its own data handling, credentials, integration code and deployment, and the maintenance grows with every new one.

This repository implements a third option: small task applications on one shared framework. Each application covers one workflow. It records the event in a local transactional store and delivers it to the system of record through an outbox. The framework provides what every such application needs and should not reimplement:

- one writer per workspace, with state, receipt, change journal and outbox committed atomically;
- authorization that comes from the host session and is checked again at commit;
- live updates to every open view after any commit;
- delivery to external systems that is at least once and reports accepted, rejected and uncertain outcomes separately.

Each operation is declared once in a catalog. HTTP, MCP, CLI, the typed UI client and the reference documentation are generated from that catalog. The same operation is therefore available to a person in the UI, an agent over MCP, a script over the CLI and another service over HTTP, with identical validation and authorization. Handing part of a workflow to an agent or a script needs no second implementation and no wider credentials.

These applications run at the edge for three reasons, covered in [edge applications](edge-applications.md#why-at-the-edge): agent harnesses run locally and work through CLIs; the software that stayed on the desktop is control software for long-lived, expensive equipment; and reaching that software (COM, RPC, files, network protocols, the screen) needs code on the machine or its network segment. The application and its connectors therefore run on the edge host, next to the agents that call it, and central systems are reached only through the outbox and inbound sync.

The repository makes this approach concrete enough to evaluate: which guarantees the framework must give, what an application author writes, and where the approach stops. Whether it saves money for a given workflow is not measured here. The [task and workflow pattern](task-workflow-pattern.md) gives the cost model and the conditions under which it does not pay off.

## Stack

Bun 1.4, TypeScript 7, Zod 4 for schemas, SQLite (`bun:sqlite`) for local storage, CASL for policy, React 19 with Vite, TanStack Query and shadcn/Tailwind 4 for the UI, Electron 44 for the desktop wrapper, Playwright for browser tests. Exact versions are pinned in `bun.lock`.

## Layout

Four layers ([ADR 005](decisions/005-framework-shell-content.md), [ADR 010](decisions/010-host-plugins.md)). Content depends on framework contracts and lists the plugins it composes. Plugins depend on the framework. The starter depends on the framework and learns its content only from configuration. `bun run check:boundaries` rejects framework → plugin/starter/content, plugin → starter/content, starter → plugin/content and content → starter imports.

| Path                   | Layer     | Contents                                                                                                  |
| ---------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| `packages/contracts`   | Framework | `defineCapability`, `defineModule`, `buildCatalog`, JSON schemas, protocol errors. Browser-safe.          |
| `packages/runtime`     | Framework | `createApplication`: authorization, transactions, revisions, receipts, journal, outbox                    |
| `packages/host`        | Framework | `defineApplication`, `startHost`, `createCli`: workspace ownership, sessions, launch, surfaces, providers |
| `packages/frame`       | Framework | Web frame as a shadcn registry: session bindings, routing, palette, run panel, accounts                   |
| `packages/adapters`    | Framework | HTTP/SSE, MCP (stdio), CLI, SQLite storage, CASL policy, workspace lock, UI sessions                      |
| `packages/client`      | Framework | Typed client, live queries with snapshot cursors                                                          |
| `packages/react`       | Framework | React and TanStack Query bindings, capability forms                                                       |
| `packages/integration` | Framework | `SystemOfRecordPort`, `createTargetIntegration`: outbox dispatcher, inbound sync                          |
| `packages/agents`      | Framework | Run supervisor and harness adapters: Codex app-server, Claude Agent SDK, AI SDK, deterministic            |
| `packages/station`     | Framework | Observer, connector and controller for control software reached through its screen                        |
| `packages/devices`     | Framework | Scanner profiles, decoding and scan routing                                                               |
| `packages/operator-ui` | Framework | shadcn registry of point-of-work input components                                                         |
| `packages/testing`     | Framework | Scenario drivers and conformance suites                                                                   |
| `packages/scaffold`    | Framework | Exports the starter, the framework and one or all examples into a new repository                          |
| `apps/service`         | Starter   | Service and CLI entrypoints that load the configured application                                          |
| `apps/web`             | Starter   | Web root, stock shadcn primitives, styles; shadows frame files at the same `src/` path                    |
| `apps/desktop`         | Starter   | Electron wrapper that starts or attaches to the service                                                   |
| `examples/*`           | Content   | Applications, each with its tests (`test/`) and end-to-end specs (`e2e/`)                                 |

`app.config.json` names the hosted application in its `application` field; `AGENT_NATIVE_APPLICATION` overrides it in development. One running authority hosts one application, with its own catalog, generated references (`docs/reference/<id>/`), web build (`dist/web/<id>/`) and workspace.

## Applications

An application has three entrypoints:

| File             | Runs in | Declares                                                                                                           |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `manifest.ts`    | Browser | Id, title and capability modules (`defineManifest`)                                                                |
| `application.ts` | Server  | `defineApplication`: state factory and upgrade, handlers, authorization, services, selectable resources, `connect` |
| `screens.tsx`    | Browser | Routes, navigation, the screen each capability family opens, a status slot                                         |

`connect` wires systems of record (through `createTargetIntegration`) and observers once the runtime exists. Observers start only in a serving host, never in an embedded CLI or MCP authority. The definition is trusted code: its policy, handlers and connections run with the host's privileges, and only callers are untrusted.

## Capabilities and modules

A capability is a command or query described as data. Contracts import no handlers, drivers or SDKs, so the browser and the generators can load them.

```ts
// contracts.ts
export const rename = defineCapability({
  id: 'note.rename',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string(), title: z.string().min(1) })),
  output: jsonSchema(z.strictObject({ id: z.string(), title: z.string() })),
  permission: { action: 'update', resourceType: 'note' },
  ui: { binding: 'note.rename' },
});
export const notes = defineModule({ id: 'notes', capabilities: [rename] });
```

The handler lives in a server entrypoint and receives a `HandlerContext`:

```ts
// server.ts
export const renameHandler = handler(rename, (input, ctx) => {
  const note = Object.hasOwn(ctx.state.notes, input.id) ? ctx.state.notes[input.id] : undefined;
  if (!note) throw new ApplicationError('NOT_FOUND', 'Note unavailable');
  note.title = input.title;
  ctx.change(`note:${note.id}`); // required; an undeclared mutation fails the command
  return { id: note.id, title: note.title };
});
```

Add the module to `manifest.ts` and the handler to `application.ts`; no framework or starter file changes. Composition builds the catalog and fails at startup on duplicate IDs, missing or cyclic dependencies, operations without a UI binding or a declared exception, unresolved workflow references, and colliding MCP names. See [capability authoring](capability-authoring.md).

## Generated artifacts

`bun run generate` reads only the catalogs and writes, per application:

| File                                     | Contents                                   |
| ---------------------------------------- | ------------------------------------------ |
| `docs/reference/<id>/contract.json`      | Full interaction contract and JSON Schemas |
| `docs/reference/<id>/openapi.json`       | OpenAPI for the HTTP surface               |
| `docs/reference/<id>/operations.md`      | Operation reference with MCP and CLI names |
| `docs/reference/<id>/workflows.md`       | Workflow reference                         |
| `docs/reference/<id>/application-skill/` | Agent skill describing the operations      |

`bun run check:generated` fails when these files differ from the catalogs.

## Surfaces

All surfaces call the same runtime. Principal, workspace and grant come from the host session, never from operation input.

| Surface      | Entry                                                                             | Identity                                                                                            |
| ------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| HTTP         | `POST /api/v1/commands/<id>`, `POST /api/v1/queries/<id>`, `GET /api/v1/contract` | Browser: one-use launch exchange, then an HttpOnly cookie. Process: bearer from the connection file |
| Live updates | `GET /api/v1/events` (SSE)                                                        | Same session; events filtered by current read permission                                            |
| MCP          | `mcp` over stdio, one tool per operation (`task.create` → `task_create`)          | Connection file, or a grant file with `--embedded`                                                  |
| CLI          | Generated subcommands, or `call <id> '<json>' --key <k>`                          | Connection file, or a grant file with `--embedded`                                                  |
| React        | `packages/client` and `packages/react` typed bindings                             | Browser session                                                                                     |

Commands require an idempotency key over HTTP, MCP and CLI. One process owns a workspace (OS file lock). The CLI and MCP server attach to that process, or run the runtime in-process with `--embedded` when no host holds the lock. `bun run build:cli` compiles the CLI and MCP server into one executable for sandbox images. At the edge, agents use a grant-bound connection to the running application ([agents at the edge](edge-applications.md#agents-at-the-edge)); `--embedded` serves sandbox images.

## Command execution

`invokeRaw` in `packages/runtime/src/index.ts`:

1. Resolve the capability and validate input against its schema. Validate `idempotencyKey` (at most 256 characters) and `expectedRevisions`.
2. Open a storage transaction for the workspace.
3. If a receipt exists for `(principal, idempotencyKey)`: authorize in phase `replay`, compare the request fingerprint (operation, input, expected revisions, run, grant) and fail with `IDEMPOTENCY_CONFLICT` on mismatch, re-project the stored result under current permissions, return it.
4. Authorize in phase `invoke` (operation, object, fields, delegation grant).
5. Compare `expectedRevisions` with current resource revisions. A mismatch fails with `CONFLICT`.
6. Run the handler. It mutates its state slice, calls `ctx.change(resource)` for each changed resource, and may call `ctx.enqueue(effect)` for outbox effects.
7. Fail if state changed without a `ctx.change` call, or if an effect's resource was not declared as changed.
8. Project the output through `projectOutput` (field permissions) and validate it against the output schema.
9. Authorize again in phase `commit` with the previous and new state. Check cancellation.
10. Increment revisions, append journal events, store the receipt. The transaction commits state, revisions, receipt, journal and outbox effects together, or nothing.

The result is a `CommandReceipt`:

```ts
interface CommandReceipt<T> {
  operation: string;
  result: T;
  cursor: number; // journal position of this commit
  authorizationRevision: number;
  revisions: Record<string, number>; // new revision per changed resource
  effects?: string[]; // outbox effect IDs, if any were enqueued
}
```

Queries authorize in phase `invoke`, scope rows before filtering, pagination and counts, and return a snapshot with a journal cursor. The client subscribes from that cursor, so no commit between query and subscription is missed. On an authorization change the client clears protected data and queries again.

## Storage and authorization ports

```ts
interface Storage<State> {
  transact<T>(workspaceId: string, fn: (s: WorkspaceSnapshot<State>) => Promise<T>): Promise<T>;
  read<T>(
    workspaceId: string,
    fn: (s: Readonly<WorkspaceSnapshot<State>>) => Promise<T>,
  ): Promise<T>;
}
interface AuthorizationPort<State> {
  authorize(req: AuthorizationRequest<State>): Decision | Promise<Decision>; // phase: invoke | commit | replay
  projectOutput?(req): unknown;
  canReadEvent(req): boolean | Promise<boolean>;
}
```

`WorkspaceSnapshot` holds feature state, cursor, authorization revision, resource revisions, receipts, journal and outbox. Feature state is opaque to the runtime. The SQLite adapter stores the whole snapshot as JSON per workspace, so it suits small local workspaces only. The CASL adapter translates a bounded condition subset into both object checks and SQL scopes and is tested for agreement between the two. Replacement adapters must pass the storage and security conformance suites.

## External systems

Handlers never call a remote system. A command enqueues an effect in its own transaction; the dispatcher delivers it after commit.

```ts
interface SystemOfRecordPort<Item> {
  describe(): TargetDescription;
  deliver(effect: Effect, signal: AbortSignal): Promise<EffectOutcome>; // accepted | rejected; throw to retry
  lookup?(effectId: string, signal: AbortSignal, effect?: Effect): Promise<LookupResult>; // outcome | uncertain | undefined
  pull?(cursor: string | undefined, signal: AbortSignal): Promise<PullBatch<Item>>; // inbound sync
}
```

- Delivery is at least once. The effect ID is the target's idempotency key; for targets without idempotency, `lookup` runs before a retry.
- A domain settle command (`ctx.settleEffect`), running as a narrowly granted integration principal, records the outcome. The outcome and its domain update commit together and reach subscribers through the journal.
- Effect status is `pending`, `accepted` or `rejected`. A pending effect is held when `lookup` returns `uncertain` or a screen procedure is interrupted. A held effect is not redelivered until a person settles or releases it.
- `pull` imports upstream changes as ordinary commands, from a stored watermark.
- A capability that enqueues declares `integration: { target, delivery: 'outbox' }`. Generated docs and MCP annotations then state that its receipt is not upstream acceptance.
- `drain` exits non-zero while any target has undelivered effects.

The same port covers an ERP API, a file drop and control software reached through its screen. There are no distributed transactions, and no reconciliation of uncertain outcomes beyond held effects.

## Agents

An agent reaches the application through MCP or the CLI under a delegated grant: a subset of operations and resources, optionally bound to a run and an expiry. A grant only narrows the initiating principal's permissions. The supervisor in `packages/agents` starts runs, restricts their tools to catalog operations, and records run state separately from commits; streamed text is not a commit. Provider credentials grant no workspace access. Perception models (OCR, vision) sit behind ports and only propose readings; deterministic code validates them and acts. See [agents at the edge](edge-applications.md#agents-at-the-edge) and [agent harnesses](agent-harnesses.md).

## Rules

Summaries of the [principles](principles.md). Each principle there lists what it rules out and which checks and tests enforce it.

| ID  | Rule                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------- |
| P1  | Every operation runs on UI, MCP, CLI and API through one handler; a missing surface is declared                |
| P2  | All tools, schemas and docs are generated from the catalog; contracts import no handlers or SDKs               |
| P3  | Identity and grants come from the host; authorization is rechecked inside the transaction and at commit        |
| P4  | All writes are commands to the workspace's single authority; no I/O inside a transaction                       |
| P5  | Every commit reaches every authorized view through the journal; drafts are kept and conflict explicitly        |
| P6  | Receipt, dispatch, acceptance, rejection and uncertainty are separate states                                   |
| P7  | Other systems are changed only through outbox effects; declared remote queries read them live, storing nothing |
| P8  | Per-site differences are versioned configuration; domain code stays out of the framework and starter           |
| P9  | Storage, policy, identity, harness, inference, connectors, perception and devices sit behind ports             |
| P10 | Deterministic, browser, native, device and live-provider evidence are recorded separately                      |
| P11 | Framework, starter and content are separate layers; one application per authority, selected by configuration   |
| P12 | Applications run beside the work; commits never wait for a system of record, a wider network or a model        |
| P13 | The application reaches only what it declares and the site binds, and records what it does                     |

## Examples

| Example                                                | Exercises                                                                                                                                                                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`project-tasks`](../examples/project-tasks)           | Runtime only, no external system: role-based access, field projection, revisions, live updates, a deterministic agent harness. Also the fixture for the transport, storage and security conformance suites.                                                             |
| [`quality-inspection`](../examples/quality-inspection) | Outbox delivery and inbound sync against an in-memory mock quality system; keyboard capture UI; sandboxed CLI/MCP binary ([reference](system-of-record-pattern.md))                                                                                                     |
| [`line-station`](../examples/line-station)             | Control software driven through its screen as an outbox connector; MES sync; scanner routing; held effects ([pattern](operator-workstation-pattern.md), [ADR 004](decisions/004-screen-mediated-authority.md))                                                          |
| [`crm-capture`](../examples/crm-capture)               | Live search of a fake CRM with the caller's own access through two data providers; adopt via outbox and feed; an unreachable CRM as a status ([pattern](system-of-record-pattern.md#live-search-and-adoption), [ADR 009](decisions/009-remote-queries-and-adoption.md)) |

Run one with `cd examples/<name> && bun run dev` (ports 4321, 4322, 4323, 4324; each has its own workspace and desktop window, and line-station starts its fake HMI). `dev:web` in the same directory serves the browser without the window.

## Verification status

Verified locally on macOS arm64: `bun run check` (format, types, boundaries, generated artifacts, unit and conformance tests, sandbox binary, build), Chromium end-to-end tests for all three examples, and a single-example scaffold export (`--example line-station`).

Not verified: any real enterprise connector, live model inference, scanner hardware, local OCR or vision models, Windows and Linux builds, signing and distribution. The [implementation ledger](implementation-status.md) has the evidence; the [repository review](reviews/2026-10-07-repository-review.md) lists open correctness defects found by probes outside the test suites.

## Commands

```sh
bun install --frozen-lockfile
bun run dev                      # build web and open the desktop window
bun run cli list                 # list operations
bun run cli call project.create '{"name":"Launch"}' --key k1
bun run mcp                      # MCP over stdio
bun run generate                 # regenerate docs/reference/<id>/ from the catalogs
bun run check                    # full local gate
bun run test:e2e                 # Playwright
bun run scaffold <dir> --name <n> [--example <name>]
```

Environment: `AGENT_NATIVE_APPLICATION`, `WORKSPACE_PATH`, `PORT`, `AGENT_NATIVE_CONNECTION`. See [development and testing](development-and-testing.md).

## Further reading

[Edge applications](edge-applications.md) · [Principles](principles.md) · [Primitives](primitives.md) · [Architecture](architecture.md) · [Interaction contract](interaction-contract.md) · [Authorization](authorization.md) · [State and reactivity](state-and-reactivity.md) · [Adapters](adapters.md) · [Agent harnesses](agent-harnesses.md) · [Providers](providers.md) · [Task and workflow pattern](task-workflow-pattern.md) · [Decisions](decisions/)

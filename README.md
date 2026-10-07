# Agent-native desktop starter

A TypeScript architecture reference for bounded task and workflow applications in which people, agents and background jobs use the same business operations. Specialized desktop and browser interfaces can capture work at the moment it happens, while existing systems of record retain ownership of enterprise records.

Define a capability once. Explicit module composition collects its schema, permission requirements, handler binding, UI binding and workflow references. The resulting catalog drives HTTP, MCP, CLI, typed React calls and generated documentation. Changes made through any surface reach subscribed frontends through the same committed journal.

The implemented reference composes a local project/task workspace, which verifies the shared kernel, with a quality-inspection capture workflow. Its authority runs on Bun, stores a transactional snapshot in SQLite and serves a React frontend. Electron wraps that frontend and supervises the authority. Storage, policy and agent providers sit behind replaceable ports.

Read the [task/workflow pattern](docs/task-workflow-pattern.md) for the product rationale, event capture, system-of-record boundaries, CLI/MCP execution and unit economics. The [system-of-record reference](docs/system-of-record-pattern.md) describes the implemented quality-inspection capture workflow: transactional outbox and inbound sync against a mock quality system, a TanStack + shadcn capture kit, and a single CLI/MCP binary that can run embedded in a sandbox. The [operator workstation pattern](docs/operator-workstation-pattern.md) extends it to station software that can only be observed and driven through its screen. A background bridge behind the outbox reads the screen with accessibility, OCR or local vision models and runs declared procedures with readback, while operators use thick-finger input and scanners ([point-of-work input](docs/point-of-work-input.md)). The [next reference plan](docs/system-of-record-reference-plan.md) lists the gates still open, including full reconciliation of uncertain outcomes and actual sandbox enforcement.

## Run the example

Prerequisite: Bun 1.4.0 or a compatible newer version. Dependencies are pinned in `bun.lock`.

```sh
bun install --frozen-lockfile
bun run dev
```

Open the `launchUrl` printed by the service. Its launch credential is single-use and expires after one minute. The service stores workspace data in `.workspace/` by default; set `WORKSPACE_PATH` to use another directory and `PORT=0` to select an available port.

Create a project, add a task, then use **Create tasks from brief**. This deterministic harness turns each line into a command and needs no provider account. The task list updates when commands commit. Editing a task preserves its draft if another client changes the committed record.

Open **Inspection** for the system-of-record example. Lots arrive from a deterministic mock quality system; choose a lot and capture values with the keyboard (Enter records and advances). Each result is forwarded through the outbox, and its quality-system reference or rejection appears without a refresh. Set `DEMO_QUALITY_LOCKED_LOTS=4000002` to see a rejection, then resolve it under **Synchronization**.

Only one authority may own a workspace. Electron attaches to an existing authority or starts one. The MCP bridge and CLI attach to the service, or run the authority in-process with `--embedded` when no service owns the workspace.

## Use the same app through tools

Set the path printed as `connectionFile` by the host. This file is a local credential; keep it private.

```sh
export AGENT_NATIVE_CONNECTION="$(pwd)/.workspace/.connection.json"
bun run cli list
bun run cli call project.create '{"name":"Launch"}' --key create-launch
bun run cli call project.list '{}'
bun run mcp
```

Every operation is also a generated subcommand with typed flags, for example `bun run cli inspection lot list --output text` or `bun run cli help inspection result record`. `bun run build:cli` compiles the same CLI into one executable at `dist/bin/<name>` for sandbox images: `mcp --embedded --grant-file <file>` serves an agent without a network listener, and `drain` exits non-zero while captured results have not reached the system of record. See the [system-of-record reference](docs/system-of-record-pattern.md).

`bun run mcp` speaks MCP over stdio. Configure an MCP client to run that command with the connection-file environment variable. Commands take an `input` object, an `idempotencyKey` and optional `expectedRevisions`; query tools take `input`. Execution identity and effective authority come from trusted host context, never tool arguments. Membership operations may name a target principal and role; those inputs do not change the caller's authority. Provider credentials stay outside business inputs.

## Create another app

```sh
bun run scaffold /path/to/new-app --name new-app --display-name "New App"
cd /path/to/new-app
bun install --frozen-lockfile
bun run check
bun run dev
```

The target must not exist. The scaffolder exports local framework source and the canonical example, with a versioned file-hash manifest. A coding agent then replaces the example domain using the [setup skill](skills/create-agent-native-app/SKILL.md) and [capability authoring guide](docs/capability-authoring.md). It does not install global agent configuration or invent a domain from the application name.

## Architecture and extension points

| Layer                               | Responsibility                                                        |
| ----------------------------------- | --------------------------------------------------------------------- |
| `packages/contracts`                | Portable schemas, capability descriptors and catalog validation       |
| `packages/runtime`                  | Authorization, transactions, revisions, receipts and journal delivery |
| `packages/adapters`                 | CASL, SQLite, host ownership, HTTP/SSE, MCP, CLI and UI sessions      |
| `packages/client`, `packages/react` | Typed bindings, live queries, cache fences and UI primitives          |
| `packages/agents`                   | Run supervision, Codex, Claude, AI SDK and protected account flows    |
| `packages/testing`                  | Shared scenarios and independent security/transport verification      |
| `packages/scaffold`                 | Deterministic source export                                           |
| `examples/project-tasks`            | Domain contracts, handlers, feature state and permission policy       |

The runtime treats feature state as opaque. The reference SQLite adapter serializes a complete JSON snapshot, including receipts and journal, in one transaction. Storage adapters can map the snapshot to existing tables; handlers receive materialized state. Large applications may need a different unit-of-work adapter and transaction-bound repository design rather than loading the whole workspace. The framework does not impose an ORM or cloud platform.

Read the [architecture](docs/architecture.md), [interaction contract](docs/interaction-contract.md), [authorization](docs/authorization.md), [reactivity](docs/state-and-reactivity.md), [adapter guide](docs/adapters.md), [harness guide](docs/agent-harnesses.md) and [generated operation reference](docs/reference/operations.md).

## Verification and delivery

```sh
bun run check
bun run test:e2e
bun run test:scaffold
```

See [development and testing](docs/development-and-testing.md) for the full standalone acceptance flag and platform checks. [Implementation status](docs/implementation-status.md) distinguishes local checks from live provider and native OS evidence.

The framework includes current ChatGPT-plan connection code, Claude API-key execution and AI SDK execution. Provider account access, funding and workspace authority are separate. Live login/inference, provider eligibility and signed platform distribution require their own checks; deterministic protocol tests do not establish those results. See [provider details](docs/providers.md).

This is a local-first reference. Multi-device synchronization, remote multi-tenant hosting, signed releases and package publication are outside this implementation. The [original plan](IMPLEMENTATION_PLAN.md) records the design baseline and acceptance goals.

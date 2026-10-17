# Agent-native desktop starter

A TypeScript reference for applications that people and AI agents operate together, often on or next to the machines where work happens. An application captures work locally and delivers it to the systems of record that own enterprise data.

Each operation is defined once as a capability. The composed catalog drives HTTP, MCP, the CLI, typed React calls and the generated reference docs, and a change made through any of them reaches every open view through the same journal. The host runs on Bun with SQLite storage and serves a React frontend; Electron wraps it on the desktop, and an Expo app runs an application on Android and iOS.

Where to read next:

- [Overview](docs/overview.md): layout, the capability model, command execution, ports and delivery.
- [Architecture](docs/architecture.md): layers, the kernel and the invariants the checks test.
- [Systems of record](docs/system-of-record-pattern.md): outbox, inbound sync, live search and the CLI, as the `quality-inspection` and `crm-capture` examples use them.
- [Operator workstations](docs/operator-workstation-pattern.md): station software reached through its screen, as `line-station` uses it, with [point-of-work input](docs/point-of-work-input.md) for scanners and glove-sized screens.
- [Security and compliance](docs/security-and-compliance.md): declared egress under a site policy, hardening profiles, the audit log and the generated audit bundle.
- [Implementation status](docs/implementation-status.md): what has been run, what has not, and the [known defects](docs/implementation-status.md#known-defects).

## Run the example

Prerequisite: Bun 1.4.0 or a compatible newer version. Dependencies are pinned in `bun.lock`.

```sh
bun install --frozen-lockfile
bun run dev
```

The desktop window opens. The service also prints a `launchUrl` for a browser; that launch credential is single-use and expires after one minute. The service stores workspace data in `.workspace/` by default; set `WORKSPACE_PATH` to use another directory and `PORT=0` to select an available port. `bun run dev:web` serves the browser without opening the window.

Create a project, add a task, then use **Create tasks from brief**. This deterministic harness turns each line into a command and needs no provider account. The task list updates when commands commit. Editing a task preserves its draft if another client changes the committed record.

Open **Inspection** for the system-of-record example. Lots arrive from a deterministic mock quality system; choose a lot and capture values with the keyboard (Enter records and advances). Each result is forwarded through the outbox, and its quality-system reference or rejection appears without a refresh. Set `DEMO_QUALITY_LOCKED_LOTS=4000002` to see a rejection, then resolve it under **Synchronization**.

Only one authority may own a workspace. The desktop window starts that authority, or attaches to one that is already running. Closing a window that started the authority stops it; closing an attached window leaves the existing authority running. The MCP bridge and CLI attach to the service, or run the authority in-process with `--embedded` when no service owns the workspace.

## Use the same app through tools

Set the path printed as `connectionFile` by the host. This file is a local credential; keep it private.

```sh
export AGENT_NATIVE_CONNECTION="$(pwd)/.workspace/.connection.json"
bun run cli list
bun run cli project create --name Launch --key create-launch
bun run cli project list
bun run mcp
```

Every operation is also a generated subcommand with typed flags, for example `bun run cli inspection lot list --output text` or `bun run cli help inspection result record`. `bun run build:cli` compiles the same CLI into one executable at `dist/bin/<name>` for sandbox images: `mcp --embedded --grant-file <file>` serves an agent without a network listener, and `drain` exits non-zero while captured results have not reached the system of record. See the [system-of-record reference](docs/system-of-record-pattern.md).

`bun run mcp` speaks MCP over stdio. Configure an MCP client to run that command with the connection-file environment variable. Commands take an `input` object, an `idempotencyKey` and optional `expectedRevisions`; query tools take `input`. Execution identity and effective authority come from trusted host context, never tool arguments. Membership operations may name a target principal and role; those inputs do not change the caller's authority. Provider credentials stay outside business inputs.

## Create another app

```sh
bun run scaffold new /path/to/new-app --name new-app --display-name "New App" --collection note
cd /path/to/new-app
bun install --frozen-lockfile
bun run scaffold add capability note.archive --kind command --description "Archive a note. Editors only."
bun run scaffold add target ledger --collection note
bun run format && bun run generate
bun run dev
```

The target must not exist. `scaffold new` exports the starter and the framework source with a generated application in `examples/<name>` as the only content: one collection with default list and record screens, the site, network, audit and compliance plugins and its tests. `scaffold add collection|capability|target` generates a part's contract, handlers, policy rule, screens and behavioral test into it. `bun run scaffold /path/to/new-app --name new-app` without `new` exports the examples instead, or one of them as the hosted application with `--example <name>`. Both write a versioned file-hash manifest. A coding agent then shapes the generated parts into the requested domain using the [setup skill](skills/create-agent-native-app/SKILL.md) and [capability authoring guide](docs/capability-authoring.md). The scaffold does not install global agent configuration or invent a domain from the application name.

## Architecture and extension points

Each package's README covers its primitives, entrypoints, trust boundary, dependencies and tests.

| Package                                                                                                                                                                                                                                    | Responsibility                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/contracts`](packages/contracts/README.md)                                                                                                                                                                                       | Portable schemas, capability descriptors, requirements and catalog validation                                                                                                     |
| [`packages/runtime`](packages/runtime/README.md)                                                                                                                                                                                           | Authorization, transactions, revisions, receipts, journal and outbox                                                                                                              |
| [`packages/host`](packages/host/README.md), [`packages/frame`](packages/frame/README.md)                                                                                                                                                   | Generic authority host and web frame for one configured application                                                                                                               |
| [`packages/adapters`](packages/adapters/README.md)                                                                                                                                                                                         | CASL, SQLite, host ownership, HTTP/SSE, MCP, CLI and UI sessions                                                                                                                  |
| [`packages/client`](packages/client/README.md), [`packages/react`](packages/react/README.md)                                                                                                                                               | Typed bindings, live queries, cache fences, forms and capture helpers                                                                                                             |
| [`packages/agents`](packages/agents/README.md)                                                                                                                                                                                             | Run supervision, Codex, Claude, AI SDK and protected account flows                                                                                                                |
| [`packages/integration`](packages/integration/README.md)                                                                                                                                                                                   | Outbox dispatcher, connectors and inbound sync for systems of record                                                                                                              |
| [`packages/station`](packages/station/README.md)                                                                                                                                                                                           | Screen bridge to station software: observation, gated actuation, golden check                                                                                                     |
| [`packages/devices`](packages/devices/README.md), [`packages/operator-ui`](packages/operator-ui/README.md)                                                                                                                                 | Scanner input and configuration; the operator shadcn registry                                                                                                                     |
| [`packages/egress`](packages/egress/README.md), [`packages/event-log`](packages/event-log/README.md)                                                                                                                                       | Site policy and egress guard; the hash-chained audit log                                                                                                                          |
| [`plugins/site`](plugins/site/README.md), [`plugins/network`](plugins/network/README.md), [`plugins/audit`](plugins/audit/README.md), [`plugins/compliance`](plugins/compliance/README.md), [`plugins/webhook`](plugins/webhook/README.md) | Host plugins: site policy and identity; egress guard, mTLS and rule exports; audit log; auditor queries, posture, evidence and the Compliance screen; an example webhook notifier |
| [`packages/testing`](packages/testing/README.md)                                                                                                                                                                                           | Shared scenarios and UI-binding checks                                                                                                                                            |
| [`packages/scaffold`](packages/scaffold/README.md)                                                                                                                                                                                         | Deterministic source export, and generated applications and parts                                                                                                                 |
| [`apps/service`](apps/service/README.md), [`apps/web`](apps/web/README.md), [`apps/desktop`](apps/desktop/README.md)                                                                                                                       | The starter: service, web root and Electron shell                                                                                                                                 |
| [`examples/project-tasks`](examples/project-tasks/README.md), [`examples/quality-inspection`](examples/quality-inspection/README.md), [`examples/line-station`](examples/line-station/README.md)                                           | Applications: manifest, application definition, screens and tests                                                                                                                 |

The runtime treats feature state as opaque. The reference SQLite adapter serializes a complete JSON snapshot, including receipts and journal, in one transaction. Storage adapters can map the snapshot to existing tables; handlers receive materialized state. Large applications may need a different unit-of-work adapter and transaction-bound repository design rather than loading the whole workspace. The framework does not impose an ORM or cloud platform.

Start with the [primitives](docs/primitives.md): a capability catalog over a logical CQRS authority, where people, agents, scripts and devices use the same commands and queries. They are kept current with the code. Then read the [architecture](docs/architecture.md), [interaction contract](docs/interaction-contract.md), [authorization](docs/authorization.md), [reactivity](docs/state-and-reactivity.md), [adapter guide](docs/adapters.md), [harness guide](docs/agent-harnesses.md) and [generated operation reference](docs/reference/project-tasks/operations.md) (one per application under `docs/reference/<id>/`).

## Verification and delivery

```sh
bun run check
bun run test:e2e
bun run test:scaffold
```

See [development and testing](docs/development-and-testing.md) for the full standalone acceptance flag and platform checks. [Implementation status](docs/implementation-status.md) distinguishes local checks from live provider and native OS evidence.

The framework includes current ChatGPT-plan connection code, Claude API-key execution and AI SDK execution. Provider account access, funding and workspace authority are separate. Live login/inference, provider eligibility and signed platform distribution require their own checks; deterministic protocol tests do not establish those results. See [provider details](docs/providers.md).

This is a local-first reference. Multi-device synchronization, remote multi-tenant hosting, signed releases and package publication are outside this implementation.

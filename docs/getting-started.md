# Getting started

An [application](glossary.md#application) runs as a desktop window, a browser page, a CLI and an MCP server over one [workspace](glossary.md#workspace). Commands run from the repository root unless a block says otherwise.

## Workspace ownership

Only one [instance](glossary.md#instance) may own a [workspace](glossary.md#workspace). The desktop window starts that instance, or attaches to one that is already running. Closing a window that started the instance stops it. Closing an attached window leaves the existing instance running.

The CLI and the MCP bridge reach the running [host](glossary.md#host) in [attached mode](glossary.md#attached-mode), through its [connection file](glossary.md#connection-file). The CLI's `--embedded` flag puts a capability call or the CLI's own MCP verb in [embedded mode](glossary.md#embedded-mode), which opens the workspace in the CLI's process. An embedded call fails with `CONFLICT` while a live instance owns the workspace. Embedded calls and the CLI's workspace verbs for sync, drain, backup, restore and migrate open a local workspace only, so a [hosted instance](hosting.md#hosted-instance) is always reached attached.

## First run

`bun install --frozen-lockfile` installs the dependencies. `bun run dev` builds the web screens, then opens the desktop window on `project-tasks`, the application `app.config.json` names. The host also prints a [launch link](glossary.md#launch-exchange) for a browser. That link signs a browser in once and expires after one minute.

The host keeps the workspace in `.workspace/` by default. These environment variables change the defaults:

| Variable | Effect |
| --- | --- |
| `WORKSPACE_PATH` | Keeps the workspace in another directory. |
| `PORT` | 0 selects an available port instead of 4317. |

`bun run dev:web` serves the browser without opening the window.

In `project-tasks`, the task list updates when [commands](glossary.md#command) commit. The [caller](glossary.md#caller) editing a task keeps the caller's draft when another caller changes the committed record. `examples/project-tasks/e2e/workspace.pw.ts` checks both through MCP and the browser.

## Other examples

Each [example](glossary.md#example) has its own port, its own desktop window and a workspace inside its directory. Run one from that directory:

```sh
cd examples/<name>
bun run dev
```

In the same directory, `bun run dev:web` serves the browser instead. When an example has a `dev.ts`, it runs first and starts demo dependencies such as the fake HMI of the line station example.

| Example | Port | Guide |
| --- | --- | --- |
| [`project-tasks`](../examples/project-tasks/README.md) | 4321 | [State and reactivity](state-and-reactivity.md) |
| [`quality-inspection`](../examples/quality-inspection/README.md) | 4322 | [Systems of record](systems-of-record.md) |
| [`line-station`](../examples/line-station/README.md) | 4323 | [Operator workstations](operator-workstations.md) |
| [`crm-capture`](../examples/crm-capture/README.md) | 4324 | [Systems of record](systems-of-record.md) |
| [`asset-survey`](../examples/asset-survey/README.md) | 4326 | [Mobile](mobile.md) |
| [`receiving`](../examples/receiving/README.md) | 4330 | [Systems of record](systems-of-record.md) |
| [`fleet`](../examples/fleet/README.md) | 4340 | [Hosting](hosting.md#fleet) |
| [`asset-survey-field`](../examples/asset-survey-field/README.md) | none | [Mobile](mobile.md) |

`asset-survey-field` runs on a phone or emulator instead; its README has the steps.

### Quality inspection run

`quality-inspection` captures measurements and delivers them to a deterministic fake quality system. Set `DEMO_QUALITY_LOCKED_LOTS` to make the fake system reject results for a lot.

```sh
cd examples/quality-inspection
DEMO_QUALITY_LOCKED_LOTS=4000002 bun run dev
```

1. Open **Lots**. The lots arrive from the fake quality system through [inbound sync](glossary.md#inbound-sync).
2. Choose a lot and capture values with the keyboard. Enter records a value and moves to the next measurement.
3. Watch each result. The [dispatcher](glossary.md#dispatcher) delivers it from the [outbox](glossary.md#outbox), and the quality system's reference or its rejection appears without a refresh.
4. Capture a value for lot 4000002. The fake system rejects it with `LOT_LOCKED`.
5. Open **Needs attention** and send a correction for the rejected result.

`examples/quality-inspection/e2e/inspection.pw.ts` runs these steps in a browser.

## Command line

Unless a [deployment policy](glossary.md#deployment-policy) sets another identity, the host writes a connection file, `.connection.json`, in the workspace directory. Its startup message shows a CLI command with that path. The file holds a local credential with owner-only permissions; keep it private. The CLI and MCP bridge read its path from `AGENT_NATIVE_CONNECTION`.

```sh
export AGENT_NATIVE_CONNECTION="$(pwd)/.workspace/.connection.json"
bun run cli list
bun run cli project create --name Launch --key create-launch
bun run cli project list
```

`bun run cli` runs the application `app.config.json` names, and `list` prints its [catalog](glossary.md#catalog). Every [capability](glossary.md#capability) is also a generated subcommand with typed flags. A capability subcommand takes these arguments:

| Argument | Effect |
| --- | --- |
| `--key <key>` | Sets a command's [idempotency key](glossary.md#idempotency-key); a query does not take it. |
| `--output text` | Prints text instead of JSON. |

`help <capability>` describes one capability.

`AGENT_NATIVE_APPLICATION` selects another example:

```sh
export AGENT_NATIVE_APPLICATION=@agent-native/quality-inspection
export AGENT_NATIVE_CONNECTION="$(pwd)/examples/quality-inspection/.workspace/.connection.json"
bun run cli inspection lot list --output text
bun run cli help inspection result record
```

`bun run build:cli` compiles the same CLI into one executable at `dist/bin/<name>`. An image that runs an agent in isolation copies only that file and uses these verbs:

- `mcp --embedded --grant-file <file>` serves the agent over MCP under the [grant](glossary.md#grant) in the file, without listening on the network.
- `drain` delivers pending [outbox effects](glossary.md#effect) and exits with code 75 while any remain.

An embedded call without a grant file acts as the local workspace [owner](glossary.md#owner) unless the deployment policy refuses the local owner.

## MCP

`bun run mcp` serves MCP over stdio and forwards each call to the running host named in the connection file. Configure an MCP client to run that command with `AGENT_NATIVE_CONNECTION` set.

```sh
bun run mcp
```

Each capability is one MCP tool, with dots and hyphens replaced by underscores: `task.create` becomes `task_create`.

| Tool | Arguments |
| --- | --- |
| Command | `input`, an `idempotencyKey` and optional `expectedRevisions` |
| Query | `input` |

The [principal](glossary.md#principal) and grant come from the [session](glossary.md#session) or the grant file, never from tool arguments (`packages/adapters/src/mcp.ts`, `packages/host/src/cli/mcp.ts`). Membership capabilities may name another principal and a role, but those inputs do not change the caller's own grant.

## Generated reference

```sh
bun run generate
```

`bun run generate` writes each application's capability reference, OpenAPI document and application skill, among the other [generator](glossary.md#generator) outputs, to `dist/reference/<id>/`. The output is for reading and is not committed.

## New application

`scaffold new` exports the [starter](glossary.md#starter) and the framework source with a generated application as the only content. Run it from the root of this repository, then work in the new directory:

```sh
bun run scaffold new /path/to/new-app --name new-app --display-name "New App" --collection note
cd /path/to/new-app
bun install --frozen-lockfile
bun run scaffold add capability note.archive --kind command --description "Archive a note. Editors only."
bun run scaffold add target ledger --collection note
bun run format
bun run generate
bun run dev
```

The new directory must not exist. The generated application in `examples/<name>` has:

- one [collection](glossary.md#collection) with default list and record screens;
- the site, network, audit and compliance plugins;
- a cross-surface conformance test, a UI-binding test and a behavioral test.

`scaffold add` generates one part into that application:

- `collection`: its contract, handlers, policy rules, default screens and test.
- `capability`: its contract, handler, policy rule and behavioral test.
- `target`: a [target](glossary.md#target) with its contract, handlers, policy lane, an in-memory fake [connector](glossary.md#connector), a status screen and a test. Its network destination is listed as disabled in `apps/desktop/site-policy.json` until the deployment policy binds it.
- `agent`: an [agent definition](glossary.md#agent-definition) that requests approval, with a test. The first agent also adds the [approval request](glossary.md#approval-request) capabilities and a screen of pending approval requests.

With `--registry <url>`, the new application installs the framework packages from that registry at the repository's framework version instead of copying their source; `--published` uses npm's registry. No lockfile is exported in that case, so the first install runs without the frozen-lockfile flag and writes it. To try this before anything is published, serve the packages on loopback:

```sh
bun run release:serve
```

Without the `new` verb, the scaffold exports the examples instead:

```sh
bun run scaffold /path/to/new-app --name new-app
```

With `--example <name>`, it exports one example as the application the starter hosts. Every export writes a versioned list of file hashes to `scaffold.manifest.json`.

The scaffold installs no global agent configuration. A coding agent shapes the generated parts into the requested domain with the [setup skill](../packages/scaffold/skills/create-agent-native-app/SKILL.md) and the [capability authoring guide](capability-authoring.md). The other task skills live next to the package they describe and are listed in [AGENTS.md](../AGENTS.md#skills). Running `bun install` links them for Claude Code and Codex.

## References

- [Architecture](architecture.md)
- [Systems of record](systems-of-record.md)
- [Desktop](desktop.md)
- [Mobile](mobile.md)
- [Hosting](hosting.md)
- [Development and testing](development-and-testing.md)
- [Architecture](architecture.md#embedded-and-attached-modes)
- [Architecture](architecture.md#examples)

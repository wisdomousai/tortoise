# Tortoise

<img src="./docs/assets/tortoise.svg" alt="A robot tortoise" width="180" align="right">

Tortoise is a TypeScript framework for custom applications that serve specialized processes at the edge. Local procedures and equipment can make a process too specific for a standard application. Claude Code and Codex can write the application code, but starting from an empty project also leaves them to establish the infrastructure that controls access and keeps records consistent.

Tortoise supplies a runtime that executes declared operations against a workspace. Application code defines the process through those operations and its screens. The host provides the execution boundary, so a command uses the same authorization and transaction handling through every supported channel. Host plugins add configured facilities such as an audit log or access to external systems. The application declares its dependencies and the deployment policy binds them to the environment in which it runs.

The framework runs on a local computer and has a hosted-server platform. The mobile host uses its own storage and native screens; its current limits are documented in [Mobile](docs/mobile.md). Application-specific behavior stays outside the framework packages.

## Start the host

Install [Bun](https://bun.sh) and Git, then run:

```sh
git clone https://github.com/wisdomousai/tortoise.git
cd tortoise
bun install --frozen-lockfile
bun run dev:web
```

`dev:web` builds the web frame and starts the application selected by `app.config.json`. Open the `launchUrl` in its `listening` output. The link creates a browser session, works once and expires after a minute. Restart the host to issue another link.

The CLI can attach to the running instance. From the repository root in another terminal:

```sh
export TORTOISE_CONNECTION="$PWD/.workspace/.connection.json"
bun run cli help
```

`bun run dev` starts the desktop host. [Getting started](docs/getting-started.md) constructs a small application in a separate directory.

## Documentation

| Subject | Guide |
| --- | --- |
| Application composition | [Architecture](docs/architecture.md) |
| Execution and state | [Operations and state](docs/capability-authoring.md) |
| Caller protocol | [Channels and interaction](docs/interaction-contract.md) |
| Application policy | [Authorization](docs/authorization.md) |
| External integration | [Systems of record](docs/systems-of-record.md) |
| Running an instance | [Deployment and operation](docs/hosting.md) |
| Terminology | [Concept reference](docs/primitives.md) |

The [tutorials](docs/tutorials/index.md) explain how to build applications with Claude Code or Codex. Dated execution evidence and known gaps are recorded in [Implementation status](docs/implementation-status.md).

## Development

```sh
bun run check
bun run test:e2e
```

The browser suite requires `bunx playwright install chromium`. [Development and testing](docs/development-and-testing.md) describes the checks and their prerequisites. Claude Code and Codex follow [AGENTS.md](AGENTS.md) when changing this code.

Each storage transaction currently loads the workspace state. Applications whose state cannot fit that execution model require a different storage design.

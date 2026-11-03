# Tortoise

<img src="./docs/assets/tortoise.svg" alt="A robot tortoise" width="180" align="right">

A company's business runs in central systems: ERP, MES, quality management. The work behind those records happens somewhere else. A receiver counts pallets at a loading dock; an analyst runs oil tests in a lab.

Between that work and the central system there is a gap, filled by a paper form, a spreadsheet or a small program someone at the site wrote. Changing the central system for one site's step is a project across the whole company, so the site builds its own tool. It runs on the computer at that step, works offline and sits outside IT governance.

Software that fits one step precisely is worth more than what central IT saves by keeping applications few, as long as each one is cheap to build, needs little maintenance and pays for itself in weeks. Tortoise is a TypeScript framework that keeps them cheap. An application's own code is only what its step needs:

- the records of the work
- the commands that change them
- the screens people use
- the formats its central system reads

The framework stores the records in a local SQLite workspace, enforces access, keeps an audit log and controls what the application may reach on the machine. Changes for other systems (an ERP, an MES) go out through an outbox after the local commit. You declare each command and query once; people use it from React screens, and agents and scripts use the same operations over HTTP, MCP and a CLI.

## Quickstart (5 minutes)

You need [Bun](https://bun.sh) and Git.

```sh
git clone <this repository> tortoise && cd tortoise
bun install
bun run dev:web
```

`dev:web` builds the screens and starts the app named in `app.config.json` (Field Service). It prints one JSON line:

```text
{"type":"listening","application":"field-service","url":"http://127.0.0.1:4317",...,"launchUrl":"http://127.0.0.1:4317/#launch=...",...}
```

Open the `launchUrl` in a browser. The link signs you in once and expires after one minute; restart for a new one.

In a second terminal, use the CLI on the same data:

```sh
export AGENT_NATIVE_CONNECTION="$(pwd)/.workspace/.connection.json"
bun run cli work-order create --name "Pump 4 service" --site "Hall B" --key wo-1
bun run cli work-order list --output text
```

You should see:

```text
id                                    revision  name            site    closed
41076e12-...                          1         Pump 4 service  Hall B  false
```

`bun run cli help` lists every command. `bun run dev` opens the same app in an Electron window instead of a browser.

## Where to go next

| You want to                                         | Read                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| Make your own app, step by step                     | [Getting started](docs/getting-started.md)                       |
| Build a larger app with Claude Code or Codex        | [Tutorials](docs/tutorials/index.md)                             |
| Write commands, queries and screens                 | [Capability authoring](docs/capability-authoring.md)             |
| Send data to an ERP or other system                 | [Systems of record](docs/systems-of-record.md)                   |
| See how the pieces fit                              | [Overview](docs/overview.md), [Architecture](docs/architecture.md) |
| Look up a term                                      | [Glossary](docs/glossary.md)                                     |
| See what works and what is untested                 | [Implementation status](docs/implementation-status.md)           |
| Browse complete apps                                | [Examples](showcase/examples), [patterns](docs/patterns.md)      |

## Scope

- One app per instance, one computer per workspace. A [hosted instance](docs/hosting.md#hosted-instance) uses shared Postgres instead.
- Not included: managed cloud hosting, a public registry, signed distribution.
- Each commit loads the whole workspace state into memory, so very large apps need a different storage design.

## Checks

```sh
bun run check       # format, types, boundaries, skills, generated docs, unit tests, build
bun run test:e2e    # Playwright; run `bunx playwright install chromium` once first
```

Claude Code or Codex editing this repository reads [AGENTS.md](AGENTS.md) first.

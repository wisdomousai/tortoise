# Tortoise

<img src="./docs/assets/tortoise.svg" alt="A robot tortoise" width="180" align="right">

Tortoise is for small applications that do a dedicated job at the edge, on the computer or phone where the work is done. A central system holds the official record, and the application delivers its result to that system. People and agents both do the job, and a person accepts what an agent proposes.

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
export TORTOISE_CONNECTION="$(pwd)/.workspace/.connection.json"
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

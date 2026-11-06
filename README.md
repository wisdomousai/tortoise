# Tortoise

<img src="./docs/assets/tortoise.svg" alt="A robot tortoise" width="180" align="right">

Tortoise is a TypeScript framework for small applications that run at the edge and serve a process so specialized that no standard application fits it. Adapting a standard application to such a process costs as much as writing custom software, and Claude Code or Codex now writes custom software cheaply. But what it writes from scratch is fragile: whether the application checks access, keeps an audit log or gets its results into the central systems depends on what the prompts happened to ask for. Hosted app builders such as Lovable write the application the same way and run it and its records in their cloud, away from the devices, files and local network at the edge. Tortoise gives Claude Code or Codex a starting point that already does those things and runs on the computer or phone at the edge, so it writes only the code for the process.

| Principle  | Behavior |
| ---------- | -------- |
| Sandboxed  | The application builds to a CLI binary that runs inside any agent sandbox. It serves its commands over MCP in-process and delivers its outbox before the sandbox closes. |
| Zero trust | Every API call needs a session or device credential, whether a person, a script or an agent sends it. |
| Headless   | Each process step is one capability with a fixed pattern: contract, handler, policy rule and test. All logic for the step is in the capability. Screens, agents and scripts only call it. |
| Audited    | The host writes an entry to the audit log for every command, whoever sends it. |
| Outbox     | A command that has a result for a central system commits it to the outbox in the same transaction. The dispatcher delivers it, retries after a failure and asks a person when the outcome is uncertain. |
| Portable   | The same application runs on a desktop, in a browser, on a hosted server and, with native screens, on a phone. |
| AI native  | Agents run the same commands as people under a grant narrowed from a person's, and a person approves the changes an agent asks for. |
| Generated  | Skills, the scaffold and the shadcn registries give Claude Code and Codex the pattern for each part. `bun run check` fails when generated code crosses a layer, reaches the network or a child process outside the host, or breaks a test. |

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
bun run check       # format, types, boundaries, skills, plain words, generated docs, unit tests, build
bun run test:e2e    # Playwright; run `bunx playwright install chromium` once first
```

Claude Code or Codex editing this repository reads [AGENTS.md](AGENTS.md) first.

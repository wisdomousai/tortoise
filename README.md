# Tortoise

<img src="./docs/assets/tortoise.svg" alt="A robot tortoise" width="180" align="right">

Tortoise is a TypeScript framework for small applications that run at the edge and serve a process change so specialized that no standard application fits it. Building that change into an ERP or another standard application costs as much as custom software, and the result neither matches the new process exactly nor changes again when the process does. Tortoise makes the custom application cheap enough to build: the framework contains everything beyond the process change itself, including the controls IT needs before it allows the application to run, so the code written for one application stays small enough to build quickly and run with little maintenance.

| Principle  | Behavior |
| ---------- | -------- |
| Sandboxed  | The application builds to a CLI binary that runs inside any agent sandbox. It serves its commands over MCP in-process and delivers its outbox before the sandbox closes. |
| Zero trust | Every API call needs a session or device credential, whether a person, a script or an agent sends it. |
| Headless   | Each process step is one capability, written once in a fixed pattern. All logic for the step is in the capability. Screens, agents and scripts only call it. |
| Portable   | The same application runs on a desktop, in a browser, on a phone and on a hosted server. |
| AI native  | Agents run the same commands as people under a grant narrowed from a person's, and a person approves the changes an agent asks for. |
| Generated  | Skills, the scaffold, the shadcn registries and `bun run check` give Claude Code and Codex what they need to generate an application with little effort. |

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

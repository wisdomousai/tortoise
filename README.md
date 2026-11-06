# Tortoise

<img src="./docs/assets/tortoise.svg" alt="A robot tortoise" width="180" align="right">

Tortoise is a TypeScript framework for small applications that run at the edge and serve a process so specialized that no standard application fits it. Building that process into an ERP or another standard application costs as much as custom software, and the result neither matches the process exactly nor changes when the process does.

Claude Code or Codex can vibe-code the custom application cheaply, but an application that starts from an empty folder has access checks, an audit log and reliable sending of results to the central systems only if someone asks for each one, and only as well as the model builds it. Hosted app builders such as Lovable run the application and its records in their cloud, away from the devices, files and local network at the edge. Tortoise is a framework for the edge. It runs the application locally, on the computer or phone where the process takes place, and contains everything beyond the process itself, including the controls IT needs before it allows the application to run. Claude Code or Codex writes only the code for the process, in a fixed pattern, so the application stays small and keeps its access checks, audit log and delivery to the central systems through each later prompt.

| Principle  | Behavior |
| ---------- | -------- |
| Sandboxed  | The application builds to a CLI binary that runs inside any agent sandbox. It serves its commands over MCP in-process and delivers its outbox before the sandbox closes. |
| Zero trust | Every API call needs a session or device credential, whether a person, a script or an agent sends it. |
| Headless   | Each process step is one capability, written once in a fixed pattern. All logic for the step is in the capability. Screens, agents and scripts only call it. |
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

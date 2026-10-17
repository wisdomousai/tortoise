# Overview

This repository is a TypeScript reference for applications that people and AI agents operate together, often on or next to the machines where work happens. A typical one records events locally and delivers them to a system of record such as an ERP, quality system or MES. Every operation is defined once and reachable from a desktop or browser UI, HTTP, MCP and a CLI, so a person, an agent, a script or a device calls it with the same validation and authorization.

It contains a domain-neutral framework (`packages/*`), host plugins (`plugins/*`), a thin starter that hosts one application (`apps/*`) and example applications (`examples/*`). It is a reference to read, run and export, not a published library or a hosted service.

The framework provides:

- one writer per workspace, with state, receipt, journal and outbox committed atomically;
- authorization from the host session, checked again at commit;
- live updates to every open view after any commit;
- at-least-once delivery that reports accepted, rejected and uncertain outcomes separately.

## How it fits together

| Topic                                               | Where                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| Layers, packages and the reference host             | [Architecture](architecture.md)                                  |
| The building blocks, with guarantees and gaps       | [Primitives](primitives.md)                                      |
| Writing a capability                                | [Capability authoring](capability-authoring.md)                  |
| Schemas, results, errors, idempotency               | [Interaction contract](interaction-contract.md)                  |
| Who may do what                                     | [Authorization](authorization.md)                                |
| Commands, queries and live views                    | [State and reactivity](state-and-reactivity.md)                  |
| Ports and reference adapters                        | [Adapters](adapters.md)                                          |
| Outbox, inbound sync, live search, CLI and MCP      | [System-of-record pattern](system-of-record-pattern.md)          |
| Station software that has only a screen             | [Operator workstation pattern](operator-workstation-pattern.md)  |
| Scanners and glove-sized UI                         | [Point-of-work input](point-of-work-input.md)                    |
| Agents and providers                                | [Agent harnesses](agent-harnesses.md), [providers](providers.md) |
| What the application may reach, and the audit trail | [Security and compliance](security-and-compliance.md)            |
| Desktop packaging                                   | [Desktop](desktop.md)                                            |
| Running the checks                                  | [Development and testing](development-and-testing.md)            |

An application has three entrypoints:

- a browser-safe **manifest** with its capability modules;
- a server **definition** with state, handlers, authorization, services and connections to other systems;
- its **screens**.

`app.config.json` names the application the starter hosts. One running authority hosts one application, with its own catalog, generated reference (`bun run generate`, into `dist/reference/<id>/`), web build and workspace. The definition is trusted code that runs with the host's privileges; only callers are untrusted.

All surfaces call the same runtime, and principal, workspace and grant always come from the host session, never from operation input:

| Surface      | Entry                                                            | Identity                                                                 |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| HTTP         | `/api/v1/commands/<id>`, `/api/v1/queries/<id>`, `/api/v1/blobs` | Browser: one-time launch exchange, then a cookie. Process: bearer token. |
| Live updates | `/api/v1/events` (SSE)                                           | The same session, filtered by current read access                        |
| MCP          | stdio, one tool per operation (`task.create` → `task_create`)    | Connection file, or a grant file when embedded                           |
| CLI          | Generated subcommands                                            | Connection file, or a grant file when embedded                           |
| React        | Typed client and bindings                                        | Browser session                                                          |

## Stack

Bun, TypeScript, Zod for schemas, SQLite for local storage, CASL for policy, React with Vite, TanStack Query and shadcn/Tailwind for the UI, Electron for the desktop, and Playwright for browser tests. Versions are pinned in `bun.lock`.

## Examples

| Example                                                | Exercises                                                                                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`project-tasks`](../examples/project-tasks)           | The runtime alone: roles, field projection, revisions, live updates and a deterministic agent. Also the fixture for transport, storage and security conformance.                                       |
| [`quality-inspection`](../examples/quality-inspection) | Outbox delivery and inbound sync against a mock quality system, keyboard capture, and a sandboxed CLI and MCP binary ([pattern](system-of-record-pattern.md)).                                         |
| [`line-station`](../examples/line-station)             | Control software driven through its screen as an outbox connector, MES sync, scanner routing and held effects ([pattern](operator-workstation-pattern.md)).                                            |
| [`crm-capture`](../examples/crm-capture)               | Live search of a fake CRM with each caller's own access, adoption through outbox and feed, and an unreachable CRM shown as a status ([pattern](system-of-record-pattern.md#live-search-and-adoption)). |
| [`asset-survey`](../examples/asset-survey)             | A site structure under reference designations, assignments for paired phones, model extraction from photos with review, and filing into a fake EAM. Blobs, device pairing and a compact tablet screen. |
| [`asset-survey-field`](../examples/asset-survey-field) | The phone side of the survey on the [mobile host](mobile.md): offline capture with photos and scans, delivered to the hub through the peer connector, assignments received through its feed. |

Run one with `cd examples/<name> && bun run dev`; `asset-survey-field` runs on a phone or emulator instead (see its README). Each has its own port, workspace and desktop window, and `dev:web` serves the browser instead.

## Status

Verified locally on macOS arm64: the full `bun run check`, Chromium end-to-end tests for the examples, and a single-example scaffold export.

Not verified: any real enterprise connector, live model inference, scanner hardware, local OCR or vision models, Windows and Linux builds, signing and distribution. The [implementation status](implementation-status.md) holds the evidence and the [known defects](implementation-status.md#known-defects).

## Commands

```sh
bun install --frozen-lockfile
bun run dev                      # build web and open the desktop window
bun run cli list                 # list operations
bun run cli project create --name Launch --key k1
bun run mcp                      # MCP over stdio
bun run generate                 # write dist/reference/<id>/ from the catalogs
bun run check                    # full local gate
bun run test:e2e                 # Playwright
bun run scaffold <dir> --name <n> [--example <name>]
```

---
name: check-a-change
description: Choose and run the checks for a change in this repository and report the evidence honestly. Use before saying a change is done, before committing, or when deciding whether docs/implementation-status.md, docs/primitives.md, a README or a skill must change with the code.
---

# Check a change

`bun run check` is what every change must pass. [Development and testing](../../docs/development-and-testing.md) explains each check and lists the focused scripts. Run the focused ones while working, and the full check before calling the work done.

## Focused checks by kind of change

| Change | Run first |
| --- | --- |
| A capability, policy or handler in an application | `bun test examples/<app>`, `bun run generate`, `bun run test:conformance` |
| A screen or registry item | `bun run build`, `bunx playwright test examples/<app>/e2e`, `bun run check:registry:operator` for operator items |
| A framework package | `bun test packages/<name>`, `bun run check:boundaries`; `bun run test:portable` for kernel, runtime, client, integration or mobile code |
| A host plugin | `bun test plugins/<name>`, `bun run check:boundaries` |
| A connector, outbox or sync | `bun run test:integration`, `bun run test:conformance` |
| The CLI, MCP or the sandbox binary | `bun run test:sandbox`, `bun run test:service` |
| Network or firewall exports | `bun test plugins/network`; regenerate goldens with `UPDATE_GOLDEN=1` and review the diff |
| Mobile or native screens | `bun run typecheck`, `bun run check:mobile-bundle` |
| A driver SDK | the commands in that SDK's README |
| The scaffold or what it exports | `bun run test:scaffold` |
| A README, doc link or skill | `bun run check:readmes`, `bun run check:skills` |

Subprocess tests can time out under load; rerun before treating a timeout as a regression. A sandbox that blocks listening sockets makes service tests report `EADDRINUSE`.

## Reporting evidence

Report each kind of evidence on its own, and never let one stand in for another:

- **Deterministic:** what `bun run check` and the focused suites showed.
- **Browser:** Playwright against the real service.
- **Native:** a packaged build or a real OS facility, on a named platform.
- **Live:** real providers, devices, hardware or systems of record, with explicitly configured accounts.
- **By hand:** a one-off run, and what it showed.

Say which checks were skipped and why. A build is not a browser run, an export is not a release, and a fixture is not a provider login.

## What else changes with the code

- **`docs/implementation-status.md`:** edit the area's entry when the change adds or invalidates browser, native, live or by-hand evidence, or closes or opens a known gap. Do not restate what tests prove.
- **`docs/primitives.md`:** update the entry when a building block's meaning, status or location changes.
- **The workspace README:** keep its Primitives, Entrypoints, Trust boundary, Dependencies and Tests sections true.
- **The skills:** when `bun run check:skills` reports a changed surface, read each skill it names and update it for what changed: new or renamed entrypoints, exports, steps, commands and checks. Then run `bun run skills:stamp <workspace>` and commit the skill and `skills/reviewed-surface.json` with the code. A changed behavior with an unchanged surface (a new rule, a changed default, a new limit) needs the same review without the check's prompt. AGENTS.md lists every skill and how they grow.
- Generated references are never committed. `bun run generate` writes them to `dist/reference/`.

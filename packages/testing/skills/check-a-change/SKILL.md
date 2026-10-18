---
name: check-a-change
description: Choose and run the checks for a change in this repository and report the evidence honestly. Use before saying a change is done, before committing, or when deciding whether docs/implementation-status.md, docs/primitives.md, a README or a skill must change with the code.
---

# Check a change

Every change must pass `bun run check`.

## Before writing

- In an application that installs the framework from a registry, the framework rows of the table do not apply. `bun run check` there runs what the export keeps, and `bun run check:framework` fails when two framework versions are installed.
- Subprocess tests can time out under load. Rerun one before treating a timeout as a regression.
- A sandbox that blocks listening sockets makes the `test:service` suites report `EADDRINUSE`.

## Steps

1. Run the focused checks for the change while working.
2. Run `bun run check` before calling the work done.
3. Edit the area's entry in `docs/implementation-status.md` when the change adds or invalidates browser, native, live or by-hand evidence, or closes or opens a known gap. Do not restate what tests prove.
4. Update the entry in `docs/primitives.md` when a building block's meaning, status or location changes.
5. Keep the package README's Primitives, Entrypoints, Trust boundary, Dependencies and Tests sections true.
6. When `bun run check:skills` reports a changed surface, read each skill it names. Update it for what changed: new or renamed entrypoints, exports, steps, commands and checks.
7. Review the skills the same way for a changed behavior with an unchanged surface, such as a new rule, a changed default or a new limit. The check does not prompt for it.
8. Run `bun run skills:stamp <workspace>` once the skills are reviewed.
9. Commit the skill and `scripts/reviewed-surface.json` with the code.
10. Leave generated references out of the commit. `bun run generate` writes them to `dist/reference/`.
11. Report each kind of evidence separately:
    - **Deterministic:** what `bun run check` and the focused suites showed.
    - **Browser:** Playwright against the real host.
    - **Native:** a packaged build or a real OS facility, on a named platform.
    - **Live:** real providers, models, devices, hardware or [systems of record](../../../../docs/glossary.md#system-of-record), with explicitly configured accounts.
    - **By hand:** a one-off run, and what it showed.
12. Say which checks were skipped and why. A build does not count as a browser run, an export does not count as a release, and a fixture does not count as a provider login.

## Checks

| Change | Run first |
| --- | --- |
| A capability, policy or handler in an application | `bun test examples/<app>`, `bun run generate`, `bun run test:conformance` |
| A screen or registry item | `bun run build`, `bunx playwright test examples/<app>/e2e`, `bun run check:registry:operator` for operator items |
| A framework package | `bun test packages/<name>`, `bun run check:boundaries`; `bun run test:portable` for kernel, runtime, client, integration or mobile code |
| A host plugin | `bun test plugins/<name>`, `bun run check:boundaries` |
| An agent definition, or a capability an agent calls | `bun test examples/<app>/test/agent-scenarios.test.ts`; a run against a model only with a configured harness and `AGENT_SCENARIOS=live`, reported as live evidence |
| A connector, outbox or sync | `bun run test:integration`, `bun run test:conformance` |
| The CLI, MCP or the sandbox binary | `bun run test:sandbox`, `bun run test:service` |
| The execution host, the process port or the seccomp filter | `bun test plugins/execution-host plugins/process`, then `bun run test:execution-host:linux` (Docker) for the bubblewrap tests, which skip off Linux |
| A model entry, the model server or the model gate | `bun test plugins/model-server packages/agents`; a real llama-server or vLLM run is live evidence |
| A storage adapter, the workspace lease or the hosted platform | `bun test packages/testing/test/storage.test.ts packages/testing/test/postgres-lease.test.ts packages/host/test/hosted-platform.test.ts`; with `STORAGE_POSTGRES_URL` set against a throwaway server, reported as by-hand evidence |
| The fleet agent or the fleet protocol | `bun test plugins/fleet-agent`; a run against a real fleet across a network is by-hand evidence |
| The telemetry plugin | `bun test plugins/telemetry`; a run against a real collector and backend is by-hand evidence |
| Network or firewall exports | `bun test plugins/network`; regenerate goldens with `UPDATE_GOLDEN=1` and review the diff |
| Mobile or native screens | `bun run typecheck`, `bun run check:mobile-bundle` |
| A driver SDK | the commands in that SDK's README |
| A framework package's imports, dependencies or packed files | `bun run check:manifests`; `bun scripts/check-manifests.ts --write` rewrites the manifests |
| A change that should reach the next framework release | `bun run changeset` to record it; the release scripts are in [development and testing](../../../../docs/development-and-testing.md#framework-packages) |
| The scaffold or what it exports | `bun run test:scaffold`; `SCAFFOLD_ACCEPTANCE=1 bun test packages/scaffold/src/generate.test.ts -t "from a registry"` for an export that installs the framework |
| A README, doc link or skill | `bun run check:readmes`, `bun run check:skills`; prose follows `docs/styleguide.md` |

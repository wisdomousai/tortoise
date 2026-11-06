---
name: check-a-change
description: Select checks for a repository change and report their actual evidence. Use before reporting completion or preparing a commit, including review of affected skills and implementation-status entries.
---

# Check a change

Choose checks for the changed behavior and its execution boundary. Use the table below for focused verification, then run the required repository check before reporting completion. State what each result establishes.

## Before writing

- In an application that installs the framework from a registry, the framework rows of the table do not apply. `bun run check` there runs what the export keeps, and `bun run check:framework` fails when two framework versions are installed.
- A source export that leaves out examples and patterns currently reports those missing paths and changed root scripts in `check:skills`. Run the applicable focused checks too, and report the unresolved full-check failure.
- Subprocess tests can time out under load. Rerun one before treating a timeout as a regression.
- A sandbox that blocks listening sockets makes the `test:service` suites report `EADDRINUSE`.

## Steps

1. Run the focused checks for the change while working.
2. Run `bun run check` before calling the work done.
3. Edit the area's entry in `docs/implementation-status.md` when the change adds or invalidates browser, native, live or by-hand evidence, or closes or opens a known gap. Do not restate what tests prove.
4. Update the entry in `docs/primitives.md` when a building block's meaning, status or location changes.
5. Keep the relevant README's purpose, entrypoints, trust boundaries, failure behavior and test instructions accurate.
6. When `bun run check:skills` reports a changed public API, read each skill it names. Update it for what changed: new or renamed entrypoints, exports, steps, commands and checks.
7. Review the skills the same way for a changed behavior with an unchanged public API, including policy or default changes. The check does not prompt for it.
8. When the public API review is complete, run `bun run skills:stamp <workspace>` for the workspace named by the check.
9. Keep the reviewed skill edits and `scripts/reviewed-api.json` with the implementation change.
10. Leave generated references out of the commit. `bun run generate` writes them to `dist/reference/`.
11. Report each kind of evidence separately:
    - **Deterministic:** what `bun run check` and the focused suites showed.
    - **Browser:** Playwright against the real host.
    - **Native:** a packaged build or a real OS facility, on a named platform.
    - **Live:** real providers, models, devices, hardware or systems of record, with explicitly configured accounts.
    - **By hand:** a one-off run, and what it showed.
12. Say which checks were skipped and why.

## Checks

Commands that name an application use the scaffold's `showcase/examples/<app>` layout. Substitute the selected application's actual workspace path when its layout differs.

| Change | Run first |
| --- | --- |
| A capability, policy or handler in an application | `bun test showcase/examples/<app>` or `bun test showcase/patterns/<name>`, `bun run generate`, `bun run test:conformance` |
| The base pattern | `bun test showcase/patterns`, since every other pattern imports it |
| A screen or registry item | `bun run build`, `bunx playwright test showcase/examples/<app>/e2e`, `bun run check:registry:operator` for operator items |
| A framework package | `bun test packages/<name>`, `bun run check:boundaries`; `bun run test:portable` for kernel, runtime, client, integration or mobile code |
| A host plugin | `bun test plugins/<name>`, `bun run check:boundaries` |
| A feature, or how an application mounts one | `bun test` on the feature's package, with `featureConformance` from `@tortoise/testing/features` in its tests, then `bun test showcase/examples/<app>` for each application that mounts it |
| An agent definition, or a capability an agent calls | `bun test showcase/examples/<app>/test/<name>-agent.test.ts`; a run against a model only with `AGENT_SCENARIOS=live`, `AGENT_SCENARIOS_URL` and `AGENT_SCENARIOS_MODEL`, reported as live evidence |
| A connector, outbox or sync | `bun run test:integration`, `bun run test:conformance` |
| The CLI, MCP or the sandbox binary | `bun run test:service`, and `bun run test:sandbox` when that script is present |
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
| A README, doc link or skill | `bun run check:skills`, `bun run docs:build`; review prose and links against `docs/styleguide.md` |

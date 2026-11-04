# Development and testing

The commands to change the framework or an application and prove the change works. When you report a change, say which checks ran and which you skipped.

## Setup

```sh
bun install --frozen-lockfile
```

`postinstall` links the task skills from [AGENTS.md](../AGENTS.md#skills) for Claude Code and Codex; rerun `bun run skills:link` after adding or renaming a skill. The starter hosts the application named in `app.config.json`; set `TORTOISE_APPLICATION` (package name or path) to override it for one launch.

## Before you commit

`bun run check` must pass. It runs, in order:

| Step | Fails when |
| --- | --- |
| `check:format` | Prettier would change a file. Fix with `bun run format`. It skips Markdown. |
| `typecheck` | `tsconfig.json` or `tsconfig.native.json` (React Native) has type errors. |
| `check:boundaries` | An import crosses layers, server code reaches a browser bundle, or code uses network or process APIs outside `scripts/boundary-rules.ts`. Portable code may not use `node:`, `bun:` or their globals. |
| `check:manifests` | A package manifest would not install on its own. |
| `check:framework` | `node_modules` contains more than one framework version. |
| `check:skills` | Skill metadata, links, paths or coverage are wrong, or a public surface changed since its last skill review. Coverage: `scripts/skill-coverage.json`. |
| `check:size` | A package `src/index.ts` contains more than re-exports. Long files and functions are hints only; split only when a file has a second job. |
| `check:words` | Markdown outside code uses a word from the Plain words lists in the [styleguide](styleguide.md). `bun run check:words <file>` or `-` (stdin) checks one file or a draft. |
| `generate` | A catalog fails to document. Output goes to `dist/reference/<id>/`; do not commit it. |
| `check:registry:operator` | Operator registry files are stale. Fix with `bun run build:registry:operator`. |
| `bun test` | Any test fails. |
| `test:portable` | Portable code relies on a Web global Hermes may lack. |
| `test:sandbox` | The compiled quality-inspection CLI fails in an empty environment or its audit log doesn't verify. |
| `build` | The web frame or a registry fails to build. |

## Test scripts

| Command | Runs |
| --- | --- |
| `bun run test:unit` | Contracts, runtime, client ordering, UI context. |
| `bun run test:conformance` | Policy, repositories, adapters, example-domain scenarios. |
| `bun run test:service` | Host, plugins, each example's HTTP boundary. Binds loopback ports. |
| `bun run test:harness` | Harness and supervision fixtures, no provider. |
| `bun run test:integration` | Outbox dispatch and inbound sync against fake systems of record. |
| `bun run test:isolated` | Everything, failing on any non-loopback connection. |
| `bun run test:e2e` | Playwright browser acceptance. |
| `bun run test:execution-host:linux [path ...]` | Bubblewrap tests in a Linux container. Needs Docker. |
| `bun run test:package` | Desktop packaging checks for this platform. |
| `bun run test:scaffold` / `test:scaffold:full` | Export safeguards; with `SCAFFOLD_ACCEPTANCE=1`, a fresh export installs, builds and tests. |

Notes:

- Firewall exports are golden files. Regenerate with `UPDATE_GOLDEN=1 bun test plugins/network` and review the diff.
- TLS tests skip without `openssl`.
- A sandbox that blocks listening sockets shows `EADDRINUSE`, even for port 0.
- Subprocess tests can time out on a loaded machine. Rerun before calling it a regression.
- Agent scenarios judge receipts and approval requests, never text. CI uses the deterministic harness. `scenarioHarness` from `@tortoise/testing` runs the local harness instead when `AGENT_SCENARIOS=live`, with a loopback `AGENT_SCENARIOS_URL` and `AGENT_SCENARIOS_MODEL`.
- Provider checks are opt-in and use an explicitly configured account. Never pick up credentials from unrelated config or fall back to a paid key.

## Run and build

| Command | Does |
| --- | --- |
| `bun run dev` / `dev:web` | Open the configured app in the desktop window / a browser. |
| `cd showcase/examples/<name> && bun run dev:web` | One example on its own port and workspace. |
| `bun run dev:showcase [<name>...]` | Every example, or the named ones, each on its own port and workspace; prints their launch links. Ctrl-C stops them all. |
| `bun run --silent cli <noun> <verb>` | The CLI from source. `bun run mcp` runs the MCP server. |
| `bun run build:cli` / `build:web` / `build:web:examples` | Compile the CLI / build the web frame / build every example into `dist/web/<id>`. |
| `bun run build:registry[:operator\|compliance\|native\|driver]` | Build a shadcn registry. |
| `bun run bundle` | Make a signing key, or create, verify and admit a bundle. |
| `bun run package:stage`, `package:desktop` | Package the [desktop](desktop.md) app. |
| `bun run dev:mobile`, `mobile:prebuild`, `check:mobile-bundle` | Start Metro / generate native projects / bundle `apps/mobile` for Android. |
| `bun run docs:dev`, `docs:build`, `docs:preview` | The [documentation site](site/README.md): serve it with a page watcher, build `dist/docs`, serve the build. CI publishes it on push to main. `docs:collect` mirrors the pages on its own; `docs:screenshots` regenerates the tutorial screenshots in `docs/assets/screenshots/` from the examples' `e2e/*.shots.ts` specs. |

Browser specs live in `showcase/{examples,patterns}/<name>/e2e/`. Packaged desktop tests skip unless you set `DESKTOP_EXECUTABLE`:

```sh
DESKTOP_EXECUTABLE=<path> bunx playwright test tests/e2e/desktop.pw.ts
```

## Station bridge demo and opt-in recognition

`cd showcase/examples/winding-line && bun run dev:web` starts a fake HMI in the same process, sets `STATION_HMI_URL`, and uses simulator mode unless you configure a recognizer. To bridge a real HMI, set `STATION_HMI_URL` yourself.

The fake HMI draws its counters as pixels, so you need a screen recognizer:

| Variable | Effect |
| --- | --- |
| `STATION_SIMULATOR=1` | Counters from simulator ground truth. Demos and tests only. |
| `STATION_VISION_BASE_URL`, `_MODEL`, `_ALLOWED_HOSTS`, `_READS` | Local OpenAI-compatible vision model, loopback unless allowlisted. |
| `STATION_RECOGNITION_WORKER=1` | The `recognition-worker` process bound under `processes` in the deployment policy. |
| `STATION_ID`, `STATION_PROFILE`, `STATION_OBSERVE_MS` | Station, profile path, observation interval. |

`bun run station:golden` runs the golden test; it ends with `PASS`. Without a model it replays recorded expectations, which only checks wiring. `STATION_GOLDEN_WORKER` (a JSON array) names a worker command. `bun run station:record-golden` re-records frames from the fake HMI; exported projects have none until you do.

## Framework packages

`packages/*`, `workstations/*` and `plugins/*` publish together at one version, as TypeScript source under the MIT license. Apps, examples and SDKs are private. Framework dependencies are `workspace:*` (packing replaces them with the exact version); React, React Native and Expo are peers.

| Command | Does |
| --- | --- |
| `bun run changeset` | Record a change; all framework packages bump together. |
| `bun run release:version` | Bump versions, write changelogs, refresh the lockfile. |
| `bun run release:pack` | Check manifests and pack into `dist/release`. |
| `bun run release:serve [--port]` | Serve the tarballs as a loopback registry for `scaffold new --registry`. |
| `bun run release:publish --registry <url>` | Publish in dependency order. Accepts `--dry-run`, `--tag`, `--access`. Never picks a registry itself. |

`bun scripts/check-manifests.ts --write` rewrites manifests. Export one example as a standalone project with the framework copied in:

```sh
bun run scaffold <target> --name <name> --example <example>
```

Add `--published` or `--registry <url>` to install the framework from a registry instead.

## Continuous integration

`.github/workflows/verify.yml` runs `bun run check`, `test:e2e` and `test:scaffold:full`; the install test with nftables on Ubuntu; and packaging on macOS arm64/x64, Windows x64 and Linux x64. It has not yet run remotely.

## See also

[Architecture](architecture.md) · [Capability authoring](capability-authoring.md) · [Implementation status](implementation-status.md)

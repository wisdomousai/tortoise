# Development and testing

Install the pinned dependencies with `bun install --frozen-lockfile`. The starter hosts the application that `app.config.json` names; `AGENT_NATIVE_APPLICATION`, a package name or a path, overrides it for one launch. The layers are described in [architecture](architecture.md). To add behavior, follow [capability authoring](capability-authoring.md).

## The checks

`bun run check` runs everything below and is what a change must pass:

```sh
bun run typecheck
bun run generate          # then commit the regenerated docs/reference
bun run check:generated
bun run check:boundaries
bun run check:readmes
bun run check:size
bun test
bun run test:portable
bun run test:sandbox
bun run build
```

| Check              | What it catches                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check:generated`  | Drift between the catalog and the generated references, security artifacts and SBOM, or a leftover reference directory.                                                                                             |
| `check:boundaries` | Imports across layers, server code reaching browser bundles, and direct network or process APIs outside the egress guard. Portable packages may not import `node:` or `bun:` modules or use Node or Bun globals.    |
| `check:readmes`    | A workspace without a README, a README whose title is not the package name, or a dead link.                                                                                                                         |
| `check:size`       | Code in a package `src/index.ts` besides re-exports. Long files and functions are listed as hints and do not fail.                                                                                                  |
| `test:portable`    | Kernel, runtime, client, integration and mobile platform code that only works because Bun supplies a Web global Hermes may lack. The suites run with those globals removed and the kernel's replacements installed. |
| `test:sandbox`     | A standalone binary that does not resolve. It compiles the CLI and runs it in an empty environment, then verifies its audit log.                                                                                    |
| `build`            | A web build or registry build that breaks for the configured application.                                                                                                                                           |

`check:size` lists files over 300 lines and functions over 80 as hints for review. Split one only when it holds a second responsibility; a long declarative table or a long but linear function can stay as it is.

A successful build is not a browser interaction or a packaged desktop launch, and each of those is checked separately.

`typecheck` runs two TypeScript projects. `tsconfig.json` covers everything with Bun and Node types. `tsconfig.native.json` covers the React Native sources without them, because React Native declares globals that conflict with Node's, and so the root project excludes those sources.

## Focused scripts

| Command                                       | Scope                                                                                                                                  |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run test:unit`                           | Contracts, runtime, client ordering and UI context.                                                                                    |
| `bun run test:conformance`                    | Policy, repositories, adapters and example-domain scenarios.                                                                           |
| `bun run test:service`                        | The host and each example's HTTP boundary and authority behavior.                                                                      |
| `bun run test:harness`                        | Harness and supervision fixtures that need no provider.                                                                                |
| `bun run test:integration`                    | Outbox dispatch and inbound sync against fake systems of record.                                                                       |
| `bun run test:isolated`                       | The whole suite, failing on any non-loopback connection from the test process.                                                         |
| `bun run test:e2e`                            | Browser acceptance with Playwright.                                                                                                    |
| `bun run test:package`                        | Desktop packaging checks available on this platform.                                                                                   |
| `bun run test:scaffold`                       | Deterministic export and its overwrite and privacy safeguards.                                                                         |
| `SCAFFOLD_ACCEPTANCE=1 bun run test:scaffold` | A fresh export that installs, typechecks, builds, tests and adds a capability on its own.                                              |
| `bun run dev` / `dev:web`                     | Open the configured application in the desktop window, or in a browser.                                                                |
| `cd examples/<name> && bun run dev`           | One example on its own port and workspace.                                                                                             |
| `bun run build:cli`                           | Compile the configured application's CLI.                                                                                              |
| `bun run build:registry:operator`             | Build the operator shadcn registry.                                                                                                    |
| `bun run mobile:prepare`                      | Write the mobile app's entry for the application `app.config.json` names for mobile.                                                   |
| `bun run dev:mobile`                          | Prepare, then start Metro for a development build on a device or emulator.                                                             |
| `bun run mobile:prebuild`                     | Prepare, then generate `apps/mobile/ios` and `apps/mobile/android` with `expo prebuild`, including the native plugins' config plugins. |
| `bun run build:registry:native`               | Build the native shadcn registry.                                                                                                      |
| `bun run check:mobile-bundle`                 | Prepare the starter's fixture application and bundle `apps/mobile` for Android with Metro.                                             |

Firewall exports are compared with golden files in the network plugin. Regenerate them with `UPDATE_GOLDEN=1 bun test plugins/network` and review the diff. The mTLS test issues throwaway certificates with `openssl` and is skipped where `openssl` is missing.

A scaffolded export copies the framework packages in, so it needs neither unpublished packages nor the original checkout. `bun run scaffold <target> --name <name> --example <example>` exports one example as the hosted application.

Service tests bind loopback ports, so a sandbox that blocks listening sockets reports `EADDRINUSE` even for port zero. Subprocess tests use temporary workspaces and stop only the processes they started. Tests that start subprocesses can time out under heavy machine load; rerun them before treating a timeout as a regression.

## Browser and desktop

Browser specs live with their application in `examples/<name>/e2e/` and start a service through the shared e2e helper. Packaged desktop tests need a built application: set `DESKTOP_EXECUTABLE` and run `bunx playwright test tests/e2e/desktop.pw.ts`. Without it they skip. See [desktop](desktop.md).

## Station bridge demo and opt-in perception

A line-station host starts a station bridge only when `STATION_HMI_URL` is set. `cd examples/line-station && bun run dev` starts the fake HMI in the same process and sets that variable together with simulator mode. To bridge another HMI, set the URL yourself. Counters on the fake HMI are pixels only, so they need a perception source:

| Variable                                                                                                  | Effect                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `STATION_SIMULATOR=1`                                                                                     | Counters come from the simulator's ground truth. For demos and tests only.                                    |
| `STATION_VISION_BASE_URL`, `STATION_VISION_MODEL`, `STATION_VISION_ALLOWED_HOSTS`, `STATION_VISION_READS` | A local OpenAI-compatible vision model, on loopback unless allowlisted. Confidence is agreement across reads. |
| `STATION_PERCEPTION_WORKER=1`                                                                             | The `perception-worker` process the site policy binds under `processes`, started by the process plugin.       |
| `STATION_ID`, `STATION_PROFILE`, `STATION_OBSERVE_MS`                                                     | Station ID, profile path and observation interval.                                                            |

`bun run station:golden` in the example gates a profile or perception change on labeled frames. Without a model configured, it replays recorded expectations, which checks only the wiring. `STATION_GOLDEN_WORKER` names a worker command (a JSON array) for the gate, started with an empty environment. `station:record-golden` re-records the frames from the fake HMI. Exported projects contain no golden images, so a configured model refuses to run there until they are recorded. A result from a live model is recorded separately from the deterministic gate.

## What the suites cover

- **Contracts and runtime:** composition, type inference, catalog validation, rollback, authorization at each point, idempotency, revisions, cancellation, grants and query purity.
- **Policy:** agreement between object checks, in-memory scopes and SQL, and domain scenarios with several roles, grants, protected fields, scoped counts and permission changes on both storage adapters. Security scenarios interrupt a command mid-flight and check that nothing commits.
- **Durability and ownership:** processes killed before and after commit, competing owners, path aliases and a killed owner.
- **HTTP and live views:** origin checks, one-time launch credentials, revoked sessions, identity spoofing, session-bound cursors, projection, the gap between snapshot and subscription, and resets that leak no identifiers.
- **Client and UI context:** out-of-order responses, revocation during a refresh, stable captured targets and fenced updates.
- **Integration:** effects commit only with their command, and delivery handles failure, rejection, lost settlement and targets that are not idempotent. The capture spec checks that a scanner burst records exactly one result per sample.
- **Transports:** conformance runs the real HTTP, CLI and MCP adapters and compares results and error codes. A listed operation is not evidence that it can be invoked.

## Providers and releases

Fixture tests prove adapter behavior, not login or inference. Provider checks are opt-in and use an explicitly configured account. Never discover credentials from unrelated configuration, and never switch silently to a paid key. The in-memory vault is a test fixture, never a fallback.

The [implementation status](implementation-status.md) records local tests, CI, browser and desktop observations, provider checks and release status separately. An export, a bundled sidecar or a passing suite is not a release. Skipped acceptance tests and unsupported platforms are reported as such.

CI follows the [GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) and the [Bun CI guide](https://bun.sh/guides/runtime/cicd). The workflow has not yet run remotely.

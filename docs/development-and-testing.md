# Development and testing

## Setup

Install the pinned dependencies:

```sh
bun install --frozen-lockfile
```

The root `postinstall` links the task skills listed in [AGENTS.md](../AGENTS.md#skills) for coding agents. `bun run skills:link` does the same by hand, after a skill is added or renamed.

The [starter](glossary.md#starter) hosts the [application](glossary.md#application) that `app.config.json` names. `AGENT_NATIVE_APPLICATION` overrides it for one launch, with a package name or a path.

## Check script

`bun run check` runs these steps in order. A change must pass it.

```sh
bun run check:format
bun run typecheck
bun run check:boundaries
bun run check:manifests
bun run check:framework
bun run check:readmes
bun run check:skills
bun run check:size
bun run generate
bun run check:registry:operator
bun test
bun run test:portable
bun run test:sandbox
bun run build
```

What each step catches:

- **`check:format`**: a file that Prettier would change. `bun run format` rewrites them, and `.prettierignore` leaves Markdown out.
- **`typecheck`**: type errors in two TypeScript projects. `tsconfig.json` covers everything with Bun and Node types, and `tsconfig.native.json` covers the React Native sources without them.
- **`check:boundaries`**: imports across layers, server code reaching browser bundles, and direct network or process APIs outside the reviewed exemptions in `scripts/boundary-rules.ts`. Portable source may not import `node:` or `bun:` modules or use Node or Bun globals.
- **`check:manifests`**: a framework package manifest that would not install on its own.
- **`check:framework`**: more than one installed framework version. It runs `scaffold versions`.
- **`check:skills`**: a skill that is out of date with the code it describes ([AGENTS.md](../AGENTS.md#skills)).
- **`check:size`**: code in a package `src/index.ts` other than re-exports. Files over 300 lines and functions over 80 lines are listed as hints and do not fail.
- **`generate`**: a [catalog](glossary.md#catalog) that cannot be documented. It writes the reference to `dist/reference/<id>/`, which is not committed.
- **`check:registry:operator`**: generated operator registry files that are out of date. `bun run build:registry:operator` regenerates them.
- **`test:portable`**: composition, runtime, client, integration and mobile platform code that works only because Bun supplies a Web global Hermes may lack. The suites run with those globals removed and the composition's replacements installed.
- **`test:sandbox`**: a standalone binary that does not resolve. It compiles the quality-inspection CLI, runs it in an empty environment and verifies its [audit log](glossary.md#audit-log).
- **`build`**: a web build or registry build that breaks for the configured application. It builds the web frame and the agent-native, operator, compliance, native and driver registries.

React Native declares globals that conflict with Node's, so the root TypeScript project excludes the React Native sources.

Split a file that `check:size` lists only when it holds a second responsibility. A long declarative table or a long linear function can stay as it is.

A successful build does not show a browser interaction or a packaged desktop launch.

## Test scripts

| Command                             | Scope                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `bun run test:unit`                 | Contracts, runtime, client ordering and UI context.                                             |
| `bun run test:conformance`          | Policy, repositories, adapters and example-domain scenarios.                                    |
| `bun run test:service`              | The host, the plugins, and each example's HTTP boundary and instance behavior.                 |
| `bun run test:harness`              | Harness and supervision fixtures that need no provider.                                         |
| `bun run test:integration`          | Outbox dispatch and inbound sync against fake systems of record.                                |
| `bun run test:isolated`             | The whole suite, failing on any non-loopback connection from the test process.                  |
| `bun run test:e2e`                  | Browser acceptance with Playwright.                                                             |
| `bun run test:execution-host:linux` | The execution host's bubblewrap tests in a Linux container. Needs Docker; the tests skip elsewhere.  |
| `bun run test:package`              | Desktop packaging checks available on this platform.                                            |
| `bun run test:scaffold`             | Deterministic export and its overwrite and privacy safeguards.                                  |
| `bun run test:scaffold:full`        | With `SCAFFOLD_ACCEPTANCE=1`, a fresh export installs, typechecks, builds, tests and adds a capability. |

## Build and run scripts

| Command                                          | What it does                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `bun run docs:dev`, `docs:build`, `docs:preview` | The VitePress site of the guides, READMEs and skills in `dist/docs`, published by `.github/workflows/docs.yml` on push to main. |
| `bun run dev` / `dev:web`                        | Open the configured application in the desktop window, or in a browser.                         |
| `cd examples/<name> && bun run dev`              | One example on its own port and workspace.                                                      |
| `bun run cli`, `bun run mcp`                     | Run `apps/service/src/cli.ts` or `packages/adapters/src/mcp.ts` from source.                    |
| `bun run build:cli`                              | Compile the configured application's CLI.                                                       |
| `bun run build:web`                              | Build the web frame for the configured application.                                             |
| `bun run build:web:examples`                     | Build the web frame once per example into `dist/web/<application id>`, as Playwright's setup.   |
| `bun run build:registry`                         | Build the agent-native shadcn registry.                                                         |
| `bun run build:registry:<name>`                  | Build the `operator`, `compliance`, `native` or `driver` shadcn registry.                       |
| `bun run bundle`                                 | Generate a signing key, or create, verify and admit a [site bundle](glossary.md#site-bundle).   |
| `bun run package:stage`, `package:desktop`       | Stage and package the desktop application for one target ([desktop](desktop.md)).               |
| `bun run format`                                 | Rewrite files with Prettier.                                                                    |
| `bun run mobile:prepare`                         | Write the mobile entry for the application `app.config.json` names for mobile.                  |
| `bun run dev:mobile`                             | Prepare, then start Metro for a development build on a device or emulator.                      |
| `bun run mobile:prebuild`                        | Prepare, then generate `apps/mobile/ios` and `apps/mobile/android` with `expo prebuild`.        |
| `bun run check:mobile-bundle`                    | Prepare the starter's fixture application and bundle `apps/mobile` for Android with Metro.      |

`mobile:prebuild` includes the native plugins' config plugins.

## Test environment

Firewall exports are compared with golden files in the network plugin. Regenerate them with `UPDATE_GOLDEN=1 bun test plugins/network` and review the diff.

The TLS and mTLS tests issue throwaway certificates with `openssl`. The tests are skipped where `openssl` is missing.

The `test:service` tests bind loopback ports. A sandbox that blocks listening sockets reports `EADDRINUSE`, even for port zero.

Subprocess tests use temporary workspaces and stop only the processes the tests started. The tests can time out under heavy machine load. Rerun the tests before treating a timeout as a regression.

## Browser and desktop

Browser specs live with the application in `examples/<name>/e2e/`. The specs start a host through the shared e2e helper.

Packaged desktop tests need a built application. Set `DESKTOP_EXECUTABLE` and run:

```sh
bunx playwright test tests/e2e/desktop.pw.ts
```

Without `DESKTOP_EXECUTABLE` the tests skip.

## Station bridge demo and opt-in perception

A line-station host starts a station bridge only when `STATION_HMI_URL` is set. `cd examples/line-station && bun run dev` starts the fake HMI in the same process and sets that variable. It also sets simulator mode unless a vision model or perception worker is configured. To bridge another HMI, set the URL yourself.

The fake HMI shows its counters only as pixels, so reading them needs a [perception source](glossary.md#perception-source):

| Variable                                                                                                  | Effect                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `STATION_SIMULATOR=1`                                                                                     | Counters come from the simulator's ground truth. For demos and tests only.                                    |
| `STATION_VISION_BASE_URL`, `STATION_VISION_MODEL`, `STATION_VISION_ALLOWED_HOSTS`, `STATION_VISION_READS` | A local OpenAI-compatible vision model, on loopback unless allowlisted. Confidence is agreement across reads. |
| `STATION_PERCEPTION_WORKER=1`                                                                             | The `perception-worker` process the deployment policy binds under `processes`, started by the process plugin.       |
| `STATION_ID`, `STATION_PROFILE`, `STATION_OBSERVE_MS`                                                     | Station ID, profile path and observation interval.                                                            |

`bun run station:golden` in the example runs the [golden check](glossary.md#golden-check) on a profile or perception change. Without a model configured, it replays recorded expectations, which checks only the wiring. `STATION_GOLDEN_WORKER` names a worker command for the gate as a JSON array, started with an empty environment.

`station:record-golden` re-records the frames from the fake HMI. Exported projects contain no golden images, so a configured model refuses to run there until they are recorded. A result from a live model is recorded apart from the deterministic gate.

## Suite coverage

- **Contracts and runtime:** composition, type inference, catalog validation, rollback, authorization at each point, idempotency, revisions, cancellation, grants and query purity.
- **Policy:** agreement between object checks, in-memory scopes and SQL. Domain scenarios with several roles, grants, protected fields, scoped counts and permission changes on both storage adapters.
- **Security scenarios:** a command interrupted mid-flight commits nothing.
- **Durability and ownership:** processes killed before and after commit, competing owners, path aliases and a killed owner.
- **HTTP and live queries:** origin checks, one-time launch credentials, revoked sessions, identity spoofing, session-bound cursors and projection. The gap between a snapshot and its live query, and resets that leak no identifiers.
- **Client and UI context:** out-of-order responses, revocation during a refresh, stable captured targets and fenced updates.
- **Integration:** effects commit only with their command. Delivery handles failure, rejection, lost settlement and targets that are not idempotent.
- **Capture:** a scanner burst records exactly one result per sample.
- **Agents:** [agent scenarios](glossary.md#agent-scenario) judge a run by its receipts and approval requests, never its text. CI runs them with the deterministic harness; a live run needs a configured harness and `AGENT_SCENARIOS=live`, and is recorded apart.
- **Surfaces:** conformance runs the real HTTP, CLI and MCP adapters and compares results and error codes. A listed capability is no evidence that it can be invoked.

## Framework packages

The packages in `packages/*`, `workstations/*` and `plugins/*` are published together at one version. Apps, examples and SDKs are private. Each package lists the dependencies its published files import. Framework packages appear as `workspace:*`, and React, React Native and Expo as peers. Packing replaces `workspace:*` with the exact shared version, so a consistent install has one copy of each.

| Command                                    | What it does                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `bun run check:manifests`                  | Fail when a package's dependencies, repository directory or packed files differ from its source, or versions differ. |
| `bun run check:framework`                  | Fail when more than one framework version is installed, such as one package pinned apart from the rest. |
| `bun run changeset`                        | Record a change for the next release. All framework packages are in one fixed group and bump together.  |
| `bun run release:version`                  | Apply the recorded changes: bump the versions, write changelogs and refresh the lockfile.               |
| `bun run release:pack`                     | Check the manifests and pack every package into `dist/release`.                                         |
| `bun run release:serve`                    | Pack, then serve the tarballs as a read-only registry on loopback, for `scaffold new --registry`.       |
| `bun run release:publish --registry <url>` | Publish the packed tarballs in dependency order to the named registry.                                  |

`bun scripts/check-manifests.ts --write` rewrites the manifests. `release:serve --port` keeps the URL a lockfile records.

`release:publish` uses the named registry's configured credentials and never picks a registry itself. It accepts `--dry-run`, `--tag` and `--access`.

The packages publish TypeScript source. The packages run under Bun and under bundlers that compile dependencies' TypeScript, such as Vite. The framework is MIT licensed. `check:manifests` copies the root `license` field into every package manifest, and `release:pack` puts the root `LICENSE` text in every tarball.

A scaffolded export copies the framework packages in, so it needs neither published packages nor the original checkout. `scaffold new` with `--published` or `--registry <url>` installs the framework from a registry instead. This command exports one example as the hosted application:

```sh
bun run scaffold <target> --name <name> --example <example>
```

## Provider checks

Fixture tests prove adapter behavior. The tests do not show login or inference. Provider checks are opt-in and use an explicitly configured account.

Never discover credentials from unrelated configuration, and never switch silently to a paid key. The in-memory vault is a test fixture and is not a fallback.

## Continuous integration

`.github/workflows/verify.yml` runs on every push and pull request:

- **source:** `bun run check`, then `bun run test:e2e` and `bun run test:scaffold:full`.
- **site-install:** `plugins/site/test/install.test.ts` with `SITE_INSTALL_NATIVE=1` on Ubuntu with nftables.
- **native:** typecheck, `test:package`, staging, the package smoke test and `package:desktop` on macOS arm64, macOS x64, Windows x64 and Linux x64.

The workflow follows the [GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) and the [Bun CI guide](https://bun.sh/guides/runtime/cicd). It has not yet run remotely.

An export, a bundled sidecar or a passing suite does not count as a release. Skipped acceptance tests and unsupported platforms are reported as such.

## References

- [Architecture](architecture.md)
- [Capability authoring](capability-authoring.md)
- [Desktop](desktop.md)
- [Implementation status](implementation-status.md)

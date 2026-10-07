# Development and testing

Install the pinned dependencies with `bun install --frozen-lockfile`. The root workspace holds three layers ([ADR 005](decisions/005-framework-shell-content.md)): framework packages in `packages/*`, the starter in `apps/*` and content in `examples/*`. The starter hosts the one application `app.config.json` names; `AGENT_NATIVE_APPLICATION` (a package name or path) overrides it for one launch. Feature authoring follows [capability-authoring.md](capability-authoring.md); permission behavior is specified in [authorization.md](authorization.md).

```sh
bun run typecheck
bun run generate
bun run check:generated
bun run check:boundaries
bun test
bun run test:sandbox
bun run build
```

`generate` writes deterministic contract, operation, workflow and OpenAPI references and the application skill, including CLI forms, for the configured application and every example, each under `docs/reference/<id>/`. `check:generated` fails when those files drift or a reference directory no application produces remains. `check:boundaries` checks imports, including starter-to-content and content-to-starter, and builds every application's Vite graph with a plugin that rejects host-only modules and transitive Node built-ins in browser code. `build` runs the Vite web build of the configured application into `dist/web/<id>` (flat, because the host serves only a flat directory) and builds the frame's shadcn registry into `dist/registry`; `build:web:examples` builds every example, which the Playwright global setup also does. `build:cli` compiles the configured application's CLI into `dist/bin/<name>` through a generated static entry. `check` also runs `test:sandbox`, which compiles a quality-inspection binary through the same `compileCli` function and runs it, because a source run cannot show that the standalone build resolves. Packages that optional adapters load at runtime are listed in `packages/host/src/optional-packages.ts` and stay external to every standalone build. A successful browser build is separate from a browser interaction or packaged desktop launch.

For focused work, use these scripts:

| Command                                       | Scope                                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `bun run test:unit`                           | Contracts, runtime, client ordering and UI context helpers.                                                            |
| `bun run test:conformance`                    | Policy, repositories, adapters and example-domain scenarios.                                                           |
| `bun run test:service`                        | Host package and each example's HTTP boundary and loopback authority behavior.                                         |
| `bun run test:harness`                        | Provider-independent harness/supervision fixtures.                                                                     |
| `bun run test:integration`                    | Outbox dispatcher and inbound sync against fake system-of-record ports.                                                |
| `bun run test:sandbox`                        | Compiles the single CLI binary and runs the embedded MCP/drain/serve scenario with an empty environment, then verifies its audit log. |
| `bun run test:isolated`                       | The whole suite with a trap that fails on any non-loopback connection from the test process. |
| `bun run test:e2e`                            | Real browser acceptance, configured by Playwright.                                                                     |
| `bun run dev`                                 | Build and serve the configured application from the starter.                                                           |
| `cd examples/<name> && bun run dev`           | Build and serve one example on its own port and workspace (ports 4321-4323); `line-station` adds the fake HMI.         |
| `bun run station:golden` (in `line-station`)  | Station profile and perception gate on the labeled golden frames in `examples/line-station/golden`.                    |
| `bun run station:record-golden` (same)        | Re-record golden frames from the fake HMI in Chromium after changing the simulator or profile.                         |
| `bun run dev:hmi` (same)                      | Start the fake station HMI on port 4610 with simulation endpoints, for the demo.                                       |
| `bun run build:registry:operator`             | Generate and build the `operator` shadcn registry into `dist/registry/operator`.                                       |
| `bun run test:package`                        | Desktop/sidecar packaging checks available on the current platform.                                                    |
| `bun run test:scaffold`                       | Deterministic export and overwrite/privacy safeguards.                                                                 |
| `SCAFFOLD_ACCEPTANCE=1 bun run test:scaffold` | Fresh source export, frozen pinned dependency installation, independent typecheck/build/tests and an added capability. |

Security artifacts are deterministic: `generate` also writes the security manifest, data flows, control mapping and CycloneDX SBOM. `check:boundaries` also fails on direct network or process APIs in server code outside the egress guard. Firewall exporters are covered by golden files in `packages/assurance/test/golden`; regenerate them with `UPDATE_GOLDEN=1 bun test packages/assurance` and review the diff. The goldens are text comparisons. Loading rules into `nft`, Windows Firewall, systemd or a cluster is a separate platform check, and so is mutual TLS against operator certificates. The mTLS test issues throwaway certificates with `openssl` and is skipped where `openssl` is missing.

The complete scaffold acceptance is opt-in so exported tests do not recursively export/install themselves. Its install uses the pinned public dependencies in the exported lockfile. Framework packages are copied into the export, so no unpublished package or access to the original checkout is required. `bun run scaffold <target> --name <name> --example <example>` exports one example as the hosted application.

Service tests bind loopback ports. A sandbox that blocks listening sockets can report `EADDRINUSE` even for port zero; run the authorized local integration checks in an environment that permits loopback listeners. Subprocess tests use temporary workspaces and terminate only processes they start.

Browser specs live next to their application in `examples/<name>/e2e/` and start a service with `startService(application, ...)` from `tests/e2e/service.ts`. Native acceptance requires an already packaged application. Set `DESKTOP_EXECUTABLE` to its executable and run `bunx playwright test tests/e2e/desktop.pw.ts`. Without that variable the two native tests explicitly skip. They launch real Electron with a minimal runtime `PATH`, use isolated workspaces whose paths contain spaces, verify external changes in the native window and renderer isolation, reopen persisted data after owned-sidecar shutdown, and confirm that closing an attached frontend preserves a pre-existing authority. Rerun against the final packaged bytes after any service, frontend or desktop change.

## Station bridge demo and opt-in perception

A line-station host starts a station bridge only when `STATION_HMI_URL` is set. Nothing is discovered. `cd examples/line-station && bun run dev` starts the fake HMI in the same process and sets `STATION_HMI_URL` and `STATION_SIMULATOR=1` unless they are already set. To bridge another HMI, set `STATION_HMI_URL` yourself. The bridge drives the HMI page through Playwright Chromium. Counters are pixel-only on the fake HMI, so they need a perception source:

| Variable                                                                                                  | Effect                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `STATION_SIMULATOR=1`                                                                                     | Counters come from the simulator's ground truth, and its local-input probe is used. Demo and tests only.                                 |
| `STATION_VISION_BASE_URL`, `STATION_VISION_MODEL`, `STATION_VISION_ALLOWED_HOSTS`, `STATION_VISION_READS` | A local OpenAI-compatible vision model. Loopback only, unless the host is allowlisted. Confidence is agreement across reads (default 3). |
| `STATION_PERCEPTION_WORKER`                                                                               | A JSON array command for a JSON-lines perception worker (OCR, classifiers, audio). Spawned with an empty environment.                    |
| `STATION_ID`, `STATION_PROFILE`, `STATION_OBSERVE_MS`                                                     | Station id (default `line-1`), profile path (default: the example's `station-profile.json`) and observe interval.                        |

The vision and worker variables also select the pixel extractor for `station:golden`; without them the gate replays recorded expectations, which checks wiring only. Source exports copy text files only, so exported applications have no golden PNGs: the wiring check still passes, and a configured model refuses to run until `bun run station:record-golden` has recorded them. Record live-model golden results separately in the implementation status document; a model gate is never implied by the deterministic one.

## Behavioral evidence

Contract tests compose independently authored modules, retain inferred input/output types, reject missing handlers/dependencies/workflow references and verify deterministic artifact generation. Runtime tests exercise rollback on invalid output, current/proposed authorization, duplicate requests, conflicting revisions, cancellation, bound grants and query purity.

Policy tests compare CASL object checks with memory scopes and parameterized SQLite queries. Domain scenarios run through both persistence adapters with owner/editor/viewer identities, resource-limited grants, protected fields, scoped counts/pages and permission changes. Independent security scenarios interrupt awaited output projection with cancellation, grant expiry or changed policy and verify that no data, receipt or journal entry commits.

Durability checks kill isolated subprocesses before and after commit. The former retains no partial state; the latter retains business changes, receipt and journal for replay after notification loss. Ownership checks run competing processes, a symlink alias and a killed owner to verify OS lock behavior.

HTTP checks cover Host/Origin validation, single-use launch credentials, revoked sessions, body identity spoofing, cookie write validation, session-bound cursors and private-field projection. Real host tests verify delegated agent runs cannot expand their initiating grant and that run access is scoped by principal and workspace. Query/subscription-gap checks commit after a snapshot, then subscribe from its cursor and observe the intervening change. Revocation checks assert a reset without newly forbidden resource identifiers.

Controlled client iterators exercise responses that finish out of order, revocation while a refresh is pending, stale errors, and unsubscribe while a response is pending. UI context tests keep captured targets stable across selection changes, reject cross-session access, fence delayed updates and exercise intent acknowledgement/expiry.

Outbox tests check that effects commit only with their command and survive replay without duplication; dispatcher tests drive transient failure, rejection, lost settlement and non-idempotent targets against fake ports. The capture e2e test records with the keyboard only, simulates a wedge-scanner burst and a double Enter, and asserts through the API that exactly one result exists per sample.

MCP/CLI conformance must invoke the actual transport adapter and compare business results and structured error codes with HTTP/direct invocation. Catalog discovery is insufficient evidence: a listed operation still needs invocation authorization. Browser/Electron acceptance additionally verifies that external writes change open views without refresh and that a dirty editor preserves its draft while reporting a revision conflict.

## Provider and release gates

Fixture tests prove adapter/protocol behavior for controlled events; they do not prove provider login or inference access. Provider checks are opt-in and require an explicitly configured account or credential. Never discover credentials from unrelated configuration or silently switch an exhausted plan to a chargeable API key. OS credential storage availability needs its own platform check; the in-memory vault is an explicitly selected fixture, not a fallback.

Record implementation, local test results, CI results, browser/desktop observations, provider checks and release status separately in the implementation status document. An exported source tree, bundled sidecar or passing suite is not a signed or published release. Report skipped acceptance tests and unsupported platform/provider features explicitly.

CI runner labels follow the [GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Bun setup follows the [official CI guide](https://bun.sh/guides/runtime/cicd). The configured workflow has not been executed remotely in this delivery.

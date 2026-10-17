# Implementation status

This ledger records what the current source has been shown to do, and what it has not. It describes the state of the code now; git holds the history. No public release has been made.

Evidence comes in four kinds, and one never stands in for another:

- **Deterministic:** `bun run check` and the suites it runs, on loopback only.
- **Browser:** Playwright in Chromium against the real service.
- **Native:** a packaged build or a real OS facility, on a named platform.
- **Live:** real providers, devices or systems of record, with explicitly configured accounts.

When a change adds or invalidates evidence, edit the entry for that area and the latest run instead of appending a dated section. A primitive's status in [primitives](primitives.md) changes only with matching evidence here.

## Latest run

On macOS arm64 with Bun 1.4.0.

| Check                        | Result                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run check`              | 9 October 2026: 387 tests pass, 1 skip, 0 fail, and the 2 sandbox tests pass. Includes format, typecheck, boundaries, READMEs, module size, generated artifacts for four applications, the operator registry, the compiled sandbox binary and the production build. |
| `bun run test:isolated`      | 9 October 2026: passes with no non-loopback connection attempt.                                                                                                                                                                                                     |
| `bun run test:e2e`           | 9 October 2026 in Chromium: 12 pass (crm-capture 2, line-station 5, project-tasks 2, quality-inspection 3). The 2 packaged-desktop specs skip without `DESKTOP_EXECUTABLE`.                                                                                         |
| `bun run test:scaffold:full` | 9 October 2026: 4 pass. A fresh export installs with a frozen lockfile, then passes format, typecheck, build and tests on its own, and accepts a new capability.                                                                                                    |
| `bun run station:golden`     | 8 October 2026: 5 of 5 screens identified with no confident misread, against recorded expectations rather than a model.                                                                                                                                             |

## By area

### Catalog, runtime and storage

**Shown, deterministic.**

- Composition and every generated artifact.
- Authorized commands and queries with revisions and scoped idempotency.
- Receipts, journal and outbox effects that commit atomically, and replay.
- Memory and SQLite agree in conformance tests, including process death before and after commit, and a crash releasing the OS lock.
- State that shares memory and JSON with sparse arrays are refused.
- Blob references commit with their command; a rejected command leaves only the upload, which is swept after the grace period. Reads follow the referencing resource's policy, including grant scope and revocation. Attaching a known digest without an own upload or read access is refused. HTTP and direct transports upload and read blobs; HTTP responses are sandboxed. The file store writes atomically under the workspace; SQLite loads older documents without blob references.

**Limits.** SQLite stores whole JSON snapshots, which suits small local workspaces. Journal and receipts are never pruned.

### Authorization and live views

**Shown, deterministic.**

- Operation, object and field decisions.
- Rows scoped before pagination and counts.
- Grant bindings on commands, events and discovery.
- Expected revisions authorized as reads before they are compared.
- After a revocation, SSE and direct subscriptions reset, and the React cache clears protected data, even while a refetch hangs.

**Open.** A session revoked during a request does not stop it; see [known defects](#known-defects).

### Surfaces

**Shown, deterministic.** For every example, direct, HTTP, CLI subprocess and MCP calls return the same results, denials and idempotent commits. The compiled single-binary CLI runs embedded MCP, `drain` and grant-bound `serve` in an empty environment. Every operation that claims a UI binding is referenced by a screen; the rest declare why they have none.

**Shown, browser.**

- **project-tasks:** live updates from an external MCP process, drafts that keep their base revision, and paging past the first page.
- **quality-inspection:** keyboard-only capture; a draft that keeps its sample when another caller records it first.
- **crm-capture:** search, adopt and log.

### Agents and providers

**Shown, deterministic.**

- The supervisor and the deterministic harness.
- The Codex, Claude and AI SDK adapters against protocol fixtures and the real Claude SDK MCP bridge.
- The captured selection reaching every adapter.
- Redaction across streamed deltas.
- Questions, approvals, cancellation of process trees and recovery of interrupted runs.
- ChatGPT sign-in against a local signed OIDC server.
- Serialized refresh and logout for ChatGPT and generic OIDC.

**Not shown, live.** No live ChatGPT consent, token refresh or revocation, and no Claude or AI SDK inference. No provider credentials were discovered or reused.

### Systems of record

**Shown, deterministic.**

- Outbox delivery outside the transaction, settlement through domain commands, backoff, and rejection as data.
- Lookup before every send to a non-idempotent target.
- Watermark-bound inbound sync.
- Effects held for reconciliation, including when shutdown interrupts a procedure that already acted.
- A `drain` deadline that aborts delivery in flight.
- `drain` and `sync` accounting for every composed target.
- Remote queries that page with the caller's credential first.
- Delivery aggregates scoped by plant and lot for every effect resource.
- Completion counting only the samples the current plan requires.

These run over in-memory fakes in `quality-inspection` and `crm-capture`. [Remote query](primitives.md#remote-query) and [Data provider](primitives.md#data-provider) are proven on one example.

**Not shown.** There is no real system of record or CRM. Worker claims, general reconciliation and cancel-before-dispatch are missing; the [gate status](system-of-record-pattern.md#status-against-the-reference-plan) has the details. Capture timings come from synthetic runs.

### Operator workstation bridge

**Shown, deterministic.**

- **Controller:** checks the expected screen before every click, type and key; requires the declared stable reads for preconditions, readback and lookup; holds the effect when a popup or takeover interrupts a procedure.
- **Observer:** submits once per heartbeat window and keys each submission by its exact payload.
- **Perception:**
  - a perception worker becomes ready again after a restart;
  - vision requests never follow a redirect;
  - the golden gate passes on recorded expectations.
- **Scanner kit:** decoding, check digits, layout repair, calibration, routing, and serial and HID assembly, including CR-only scanners and bracketed GS1.
- **Device configuration module:** its policy.

**Shown, browser.** In `line-station`, against the real service and a separate fake HMI process:

- a stop is classified;
- an order is scanned and started with a hold;
- the recipe is loaded and read back;
- takeover blocks the bridge.

The kit's interaction tests also pass.

**Not shown.**

- **Hardware:** no physical scanner has been checked, and the desktop shell does not grant Web Serial or WebHID.
- **Models:** no local OCR or vision model has been called.
- **Computer use:** there is no live computer-use driver, and no VNC, RDP or UI Automation transport.
- **Safety:** nothing here is safety-rated or validated.

### Security and compliance

**Shown, deterministic.**

- **Plugins:** every example composes the `site`, `network`, `audit` and `compliance` plugins. Plugin order is kept. Startup is refused when a needed port has no provider, or when a policy asks for a plugin that is not composed.
- **Egress guard:**
  - refuses host, port and scheme escapes, off-host redirects and DNS answers outside bound networks;
  - the child proxy tunnels only to declared destinations.
- **Event log:**
  - detects tampering, truncation and gaps;
  - rotates and holds a writer lock;
  - rolls back a command whose required append fails, and recovers after a crash.
- **Startup floors:**
  - identity floors are enforced at startup;
  - mTLS rejects a missing certificate and a foreign CA, using a throwaway PKI.
- **Exports:** the seven rule formats match golden files.
- **Sandbox binary:** its audit chain verifies with no egress.

**Shown, browser.** The Compliance screen shows a new denial without a reload.

**Not shown.**

- **Rules:** the exported rules are compared as text only. They were never loaded into nftables, Windows Firewall, systemd or a cluster.
- **Live traffic:** no off-host syslog collector, and no live provider traffic through the guard.
- **Zero trust:** it refuses to start, because no workforce identity adapter exists.

Control mappings are indicative, not a certification.

### Desktop

**Shown, deterministic.** Packaging unit tests and the target matrix.

**Shown, native, outdated.** An earlier source state was staged and packaged unsigned on macOS arm64, from before the system-of-record, frontend and CLI changes. It passed the offline smoke test and the Electron owned and attached lifecycle tests. Rebuild and rerun them before relying on a packaged build ([desktop](desktop.md#build-and-smoke-test)).

**Not shown.**

- the current packaged build;
- Windows x64, Linux x64 and macOS x64, which are configured in CI but have not run;
- credential-vault set, get and delete on any platform;
- signing, notarization, installers and updates.

### Mobile

**Shown, deterministic.** `apps/mobile` typechecks under `tsconfig.native.json` without Bun or Node types. `bun run check:mobile-bundle` bundles it for Android with Expo SDK 58 and resolves workspace packages through their `exports` maps. Expo autolinking finds an Expo module in a workspace plugin through the root `node_modules`, checked with `expo-modules-autolinking resolve` against a temporary probe module.

The host platform is shown on a fake platform: `packages/kernel/test/kernel.test.ts` opens, closes and reopens an authority on an in-memory platform with no Node or Bun API, and checks the platform, capability, settings-provider and target refusals. The Bun host opens its embedded and serving authorities through the same kernel path, and the host and example suites pass unchanged. `bun run test:portable` runs the kernel, runtime, client and integration suites with `structuredClone`, `AbortSignal.any`, `AbortSignal.timeout` and `crypto.randomUUID` removed and the kernel's replacements installed. The audit and event-log hash chains use a pure JavaScript SHA-256 that produces the same digests as before.

**Not shown.** No platform other than Bun exists, and the globals check has not run under Hermes. The shell is a placeholder: no authority, screens or plugins run on a device. No Android or iOS build has been produced, and nothing has run on an emulator, simulator or device.

### Layers and scaffold

**Shown, deterministic.** The boundary check resolves imports by layer, including workspace package names and the browser graph of each application. A single-example export installs with a frozen lockfile and passes its own checks.

**Limits.** Framework packages are unpublished, so an export copies `packages/*` and depends on them through `workspace:*`. An authority hosts one application.

## Known defects

Defects reproduced against the current source that are not fixed yet.

| Defect                                                        | Detail                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A session revoked during a request does not stop the request. | HTTP authenticates each request once. If a session is revoked or expires while its command is waiting, the command's context stays live and the command still commits. New requests with that token are refused. To fix it, give each session an abort signal that fires on revocation and expiry, and combine that signal with the request's signal. |

These were fixed by inspection only and have no regression test:

- matching Windows paths during staging;
- keeping a scanner connected when it uses default routes;
- keeping scanner setup's unsaved edits when another device saves.

### Design follow-ups

These are improvements, not defects:

- Share event, receipt and cancellation adaptation between the HTTP and direct transports. The known defect above is one place where they still diverge.
- Extract a reusable draft model (target, base revision, local values and conflict state) from capture and scanner setup.
- Consolidate the repeated polling, delay-cancellation and credential-refresh lifecycles once their semantics settle.
- Before publishing packages, give each one explicit entrypoints and its own dependencies.

## Out of scope

- cloud hosting and multi-device synchronization;
- more than one application per authority;
- package publication;
- signed distribution.

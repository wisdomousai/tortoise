# Implementation and verification status

Checked on 7 October 2026. This ledger distinguishes implemented code, deterministic checks, native execution and live provider evidence. It describes the working source tree; no public release has been made.

## Implemented

- Pure typed capability/module contracts with validated composition, JSON Schema and generated OpenAPI, MCP names, operation reference and workflow index.
- One authorized CQRS runtime, memory/SQLite adapters, optimistic revisions, scoped idempotency, atomic receipts/journal, consistent snapshots and replay.
- CASL operation/object/row/field decisions, a bounded SQL scope translator, current grants and permission-aware output projection.
- Local authority ownership, loopback security, session bootstrap, HTTP/SSE, CLI and real MCP stdio bridge.
- Shared React frontend and Electron host, live updates, dirty-draft conflicts, scoped UI sessions and version-pinned target capture.
- Supervisor, deterministic workflow, Codex, Claude and AI SDK adapters, questions/approvals, cancellation and interrupted-run recovery.
- Explicit ChatGPT dynamic registration, identity validation, protected profile/refresh/logout, account model catalog and separate API-key funding.
- Deterministic source scaffolder, developer setup/extension skill, architecture guides and generated references.
- System-of-record capture reference: transactional outbox (`ctx.enqueue`/`ctx.settleEffect`), `packages/integration` dispatcher and inbound sync, module composition with sliced state and routed policy, and the quality-inspection example with a deterministic mock quality system. See [system-of-record-pattern.md](system-of-record-pattern.md).
- Vite + TanStack Router/Query/Form/Table + shadcn frontend; `@agent-native/react` query, form and capture bindings; a shadcn registry of kit components; capture-time and acceptance-latency metrics.
- Application CLI with catalog-generated subcommands, typed flags, dry-run, text output and mapped exit codes; embedded stdio MCP under a launcher grant; `drain`/`sync`; grant-bound agent connections from `serve`; single-binary compilation.
- Operator workstation bridge: held effects in the outbox, `packages/station` (profiles, observer, screen connector, scripted driver, Playwright transport, accessibility/worker/OpenAI-compatible vision extractors, golden gate), `packages/devices`, the `operator` shadcn registry in `packages/operator-ui`, and the `examples/line-station` domain with a fake MES and a separate-process fake HMI. See [operator-workstation-pattern.md](operator-workstation-pattern.md).

## Verified locally

| Gate             | Evidence                                                                                                                                                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source           | Typecheck, browser dependency boundaries, generated-artifact drift and production web build pass.                                                                                                                                                                                               |
| Behavioral suite | `bun run check`: 229 tests passed, 1086 assertions, zero failures, one skip. The recursive scaffold gate is deliberately skipped there and is run separately below.                                                                                                                             |
| Persistence      | Memory/SQLite conformance, rollback, replay, actual process death before/after commit and OS-lock crash release pass.                                                                                                                                                                           |
| Surface parity   | Direct, HTTP, CLI subprocess and MCP protocol scenarios agree on results, denial and idempotency for both example modules. Forbidden CLI calls exit 4.                                                                                                                                          |
| SoR delivery     | Outbox, dispatcher and inbound-sync suites: atomic effects, no re-enqueue on replay, backoff, rejection as data, idempotent redelivery, lookup-before-send, drain and integration-grant limits.                                                                                                 |
| Sandbox CLI      | `bun run test:sandbox` compiles the single binary and runs it with an empty environment: embedded MCP capture under a grant, refused integration operations and concurrent writer, drain exiting 75 then 0, agent/human metrics, grant-bound `serve`. The source-entry variant runs in `check`. |
| Capture browser  | `tests/e2e/inspection.pw.ts` in Chromium: keyboard-only capture, wedge burst and double Enter recording once, live SoR references and rejection, metrics, a generated form and a superseding correction. `tests/e2e/workspace.pw.ts` passes on the new frontend.                                |
| Browser          | Chromium with a separate MCP process: agent changes appear without refresh, UI writes are queryable, drafts survive conflicting changes and deterministic work completes.                                                                                                                       |
| Scaffold         | `bun run test:scaffold:full`: 3 tests passed, 20 assertions. Fresh export, frozen public-dependency install, format/typecheck, five generated artifacts, build, tests, app identity and a newly added capability all pass. Native install scripts are disabled in this isolated source check.   |
| macOS arm64      | Final-source native stage, unsigned directory package, native version/compiled service smoke and actual Electron owned/attached lifecycle tests pass. The combined final Playwright run passed all 3 tests with zero skips.                                                                     |
| Skill            | Skill metadata validator and isolated add-capability exercise pass.                                                                                                                                                                                                                             |

## Operator workstation bridge

Checked on 7 October 2026 on macOS arm64. Deterministic, browser, device and live-model evidence are listed separately; only the first two exist.

| Kind          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deterministic | `bun run check` passes: 229 tests, 1 skip, 0 failures, 1086 assertions. New suites: `packages/station` 26 (profile validation against forbidden regions, stability gating, uncertain readings, procedure success, precondition rejection, popup abort with readback acceptance, takeover leading to a held effect and reconciliation), `packages/devices` 21, `packages/operator-ui` 13, `examples/line-station` 9, held effects 3.  |
| Composition   | `packages/testing/test/station-conformance.test.ts`: MES sync, a station observed through the in-memory simulator, identical `line.station.get` over direct, HTTP, CLI subprocess and MCP, recipe load through the connector with readback, and lane separation (people cannot ingest; the bridge cannot read device configuration; operators cannot administer scanners).                                                           |
| Golden gate   | `bun run station:golden`: 5/5 screens identified, no confident misread. Pixel fields used recorded expectations (a wiring check), not a model.                                                                                                                                                                                                                                                                                       |
| Browser       | `tests/e2e/station.pw.ts` in Chromium against the real service and a separate fake-HMI process driven through Playwright: a stop is observed and classified with a tile and accepted by the MES; an order is wedge-scanned and started with a hold; the bridge loads the recipe on the HMI screen and reads it back; while the operator holds the seat the next load waits and completes after handback. Kit interaction tests pass. |
| Devices       | None. No wedge, serial, HID POS or camera scanner has been checked on hardware. Electron Web Serial/WebHID permission handlers are not wired.                                                                                                                                                                                                                                                                                        |
| Local models  | None. The worker protocol runs against an echo fixture. The OpenAI-compatible vision extractor is tested against a stubbed `fetch`. No local OCR or vision model was configured or called.                                                                                                                                                                                                                                           |

Not part of this reference: a live computer-use driver (the `ComputerUseDriver` port and a scripted driver exist), VNC/RDP/KVM-over-IP/UI Automation transports, vendor scanner SDKs, vendor programming-barcode sheets, live microphone capture and a scratch-app `shadcn add` acceptance test. `@agent-native/devices` and `@agent-native/station` are unpublished workspace packages. Nothing here is a safety-rated or validated system.

## Explicitly unverified

Live ChatGPT consent, model inference, real token refresh/revocation, Claude inference and AI SDK inference were not run. No existing provider credentials were discovered or reused. Signed token fixtures and native protocol fixtures establish local behavior only.

Native credential-vault set/get/delete and locked-store prompts remain platform checks. Windows x64, Linux x64 and macOS x64 execution are configured in CI but were not run on this macOS arm64 host. The workflow has not been pushed or executed remotely. Signing, notarization, installers, updates, public package publication and deployment remain outside this delivery.

## Reference implementation limits

The intended product pattern is a bounded task/workflow interface over existing systems of record. The project/task example verifies the local kernel; the quality-inspection example verifies outbox delivery and inbound sync against an in-memory, per-process mock quality system. There is no real enterprise connector. Reconciliation of uncertain outcomes, worker claims, an independently persisted mock upstream, a sandbox isolation backend or credential broker, and package lifecycle gates remain planned in the [reference plan](system-of-record-reference-plan.md); the [system-of-record reference](system-of-record-pattern.md) maps each gate. Capture timings are from synthetic runs, not field measurements.

SQLite persists complete JSON snapshots; it is intended for small local workspaces. The materialized-state port is storage-layout independent but is not a universal transaction-bound ORM. `LiveQuery` re-queries conservatively; the TanStack bindings add resource-type-indexed invalidation and coalescing. The journal/receipts have no pruning policy. UI intents are ephemeral authenticated host interactions, separate from durable business operations.

Run discovery/control is scoped to the initiating principal, workspace and delegation; nested run delegation is rejected in this reference. Model text cannot be field-redacted as a typed domain response. The service suppresses historical run output and target context after an authorization-generation change; new business queries still use current policy. Provider subprocess isolation is a limited application-tool profile rather than an OS security boundary against malicious binaries.

Use [development and testing](development-and-testing.md) and [desktop packaging](desktop-packaging.md) to reproduce the checks. See [provider documentation](providers.md) before configuring a live account.

## Final local artifact

This artifact predates the system-of-record, Vite frontend and CLI changes; the sidecar entry and frontend have changed since. `bun run test:package` passes on the current source, but the native stage, package and Electron acceptance were not rerun. Rebuild and rerun `tests/e2e/desktop.pw.ts` before relying on a packaged build.

The verified immutable stage is `artifacts/desktop/accepted-darwin-arm64`. Its unsigned application is under `packaged/mac-arm64/Project Workspace.app`. Artifacts are ignored by Git and can be reproduced with the packaging scripts.

- Environment: macOS arm64, Bun 1.4.0, TypeScript 7.0.2, Playwright 1.63.0, Electron 44.6.0.
- Compiled service SHA-256: `a36a3c737667b5ad603ac42954559993ccffd380be43720420837dd58c89647b`.
- Native version smoke: Codex CLI 0.160.1; Claude Code 2.1.292 from SDK distribution 0.3.292.
- Native acceptance used a temporary workspace containing spaces and a minimal `/usr/bin:/bin` PATH. It checked live external writes, renderer isolation, persisted reopening, owned shutdown and survival of an attached authority.
- Browser acceptance additionally checked separate MCP stdio interaction, draft conflicts and an agent question/answer.
- Both setup and generated application skill metadata validate. Local documentation links resolve.

These results apply to this implementation's local checks. No remote CI, provider login, billing/entitlement, signing or publication result is implied.

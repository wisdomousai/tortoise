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

- Collections: generated `get` and `list` scope rows before filters, search, counts and paging, and `records` writes declare their resource. crm-capture's account list and quality-inspection's lot list are generated, and all four examples use the runtime's prototype-safe `own` and `put`.

- Integration targets: crm-capture, quality-inspection and line-station declare their system of record with `defineTarget` and implement it with `targetHandlers`; their outbox, held-effect, drain, conformance and role-matrix tests pass, and `packages/integration/test/target.test.ts` covers the shared settle, sync and status behaviour.
- Agent definitions: the catalog refuses unknown, repeated or missing operations, unbounded budgets and a direct agent on a command without a UI binding (`packages/contracts/test/agent.test.ts`). `agentGrant` narrows within the issuer's grant (`packages/runtime/test/agent-grant.test.ts`). The run supervisor fails a run that exceeds its tool-call or wall-time budget (`packages/agents/test/budget.test.ts`). MCP serves each definition as a resource (`packages/adapters/src/mcp.test.ts`). project-tasks declares a planner, which appears in its generated `agents.md`, operation reference and skill. No host route starts a run from a definition yet.
- Proposals: accepting runs the proposed command once as the accepter, refuses an agent grant, a viewer and a demoted accepter, conflicts on a changed record and leaves the proposal open, refuses invalid submissions and expired proposals, and a replay returns the same continuation (`packages/runtime/test/proposal.test.ts`). In line-station the stop explainer proposes a stop reason that an operator accepts from the station's attention queue, and a stale stop or a demoted operator is refused (`examples/line-station/test/proposals.test.ts`). project-tasks' planner proposes tasks, and acceptance is checked on direct, HTTP, CLI and MCP surfaces (`examples/project-tasks/test/proposal-surfaces.test.ts`). The station tile and the frame's proposal review have no browser test yet.
- Triggers and standing grants: an event-triggered job commits once across a crash between its commit and its progress record, the audit log records its command under the issuer and run, revoking stops future runs, a demoted issuer's run becomes one open failure that is not retried, only people issue and revoke their own grants, a schedule runs once per slot within its budget, and invalid triggers refuse startup (`plugins/automation/test/automation.test.ts`). A serving host runs an enabled trigger and resumes after a restart (`plugins/automation/test/host.test.ts`). line-station's expiry job closes only expired proposals at the issuer's stations (`examples/line-station/test/proposals.test.ts`). No agent trigger has run against a model.
- Local inference: against a loopback OpenAI-compatible fixture server, the local harness lists the configured model, calls an application tool and finishes, and sends only a placeholder key; it reports an unserved model or an unbound destination as unavailable; a `local` requirement skips provider harnesses and the run record names the model and digest (`packages/agents/test/local.test.ts`). An agent trigger runs on the local harness and fails into an open failure when none qualifies (`plugins/automation/test/automation.test.ts`); a host refuses to open an agent trigger with no qualifying harness, and without a network plugin the local model is unreachable (`plugins/automation/test/host.test.ts`). Live: no real model server has been run.
- Declarative policy: all four examples' policies are built with `definePolicy`, and their role matrices, security, transport and storage suites pass unchanged. quality-inspection and line-station set roles through `defineMembership`.

- Row storage: a one-record commit on 1,000 records writes the record, its revision and the receipt, and a removal deletes one row; a stored `__proto__` key stays data; a failed transaction or another connection's commit never reuses the cached snapshot; journal retention sets the floor and a cursor behind it gets a reset; receipt retention removes the oldest; a version 1 file converts and the version 1 reader then refuses it; an online backup verifies and restores, and a damaged or foreign file is refused (`packages/adapters/src/row-storage.test.ts`). The host CLI backs up a live workspace and refuses to restore while a host owns it (`packages/host/test/workspace-backup.test.ts`). Measured on an M-series laptop, 20 one-record commits on 20,000 records (about 5 MB): rows 26–30 ms per commit, one document 46–52 ms.

**Limits.** Row storage still serializes every row to find the change, so commit CPU grows with state. Receipts are kept by default. The phone's snapshot storage has neither rows nor retention. No encryption at rest.

### Site bundles

**Shown, deterministic.** `packages/bundle/test/bundle.test.ts`: a bundle verifies against its publisher key; another key, a key listed under a foreign ID, an added or replaced file, a changed manifest, a link in the payload and an escaping path are refused; another platform, an unreadable storage schema and another application are refused; a first install and every added or widened requirement need a site approval of the exact requirements digest, and narrower requirements need none. `bun run bundle create` built a 69 MB project-tasks bundle (46 files) on macOS arm64, which `verify` accepted and `admit` refused until approved.

**Not shown.** No installer consumes a bundle yet, and nothing verifies one at launch. Bundles are directories, not archives. Approvals are unsigned site data. No cross-platform build has been verified on its target.

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
- Worker claims and fencing: a worker that paused past its lease cannot record an attempt or settle once another worker claimed, and its late attempt is kept in the audit log; a kill after the target accepted waits out the dead worker's lease and settles from the lookup without a second record; an acknowledged effect is polled, not redelivered, and drains as delivered, and a target that loses it holds it; a command cancels only an effect no worker claimed; the actor is authorized again before the first claim (roles, not preconditions), while a result already dispatched is recorded after revocation and hidden from the revoked actor; feed items not newer than the applied upstream version are dropped (`packages/integration/test/reliability.test.ts`).

These run over in-memory fakes in `quality-inspection` and `crm-capture`. [Remote query](primitives.md#remote-query) and [Data provider](primitives.md#data-provider) are proven on one example.

**Not shown.** There is no real system of record or CRM. Two dispatcher processes racing for one workspace (rather than two dispatchers in one process) and a reconciliation query across targets are not shown. Capture timings come from synthetic runs.

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
  - A `site-hub` policy serves over TLS without client certificates; `desktop-local` refuses any network listener, `zero-trust` refuses TLS without client certificates, and a client CA on a TLS listener is refused (`packages/egress/test/egress.test.ts`). With a throwaway site CA, a client without the CA fails the handshake and a phone that trusts it pairs and delivers (`plugins/device-link/test/tls.test.ts`).
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

The mobile platform opens the same authority in Bun tests with Bun's SQLite and files in place of Expo's: a capture with a photo persists across close and reopen, a second open is refused, and a deployment with an ingress destination is refused. The snapshot storage runs over one driver interface for `bun:sqlite` and `expo-sqlite`, and the storage conformance suite passes on the Bun driver.

The starter hosts a mobile application: `bun run mobile:prepare` writes the static entry for the application `app.config.json` names for mobile and refuses one whose manifest does not target mobile (`apps/mobile/test/entry.test.ts`). `check:mobile-bundle` prepares the starter's fixture application and bundles it for Android: the kernel, runtime, mobile platform, native frame and Uniwind-styled components compile to Hermes bytecode. Native screen definitions are checked in Bun (`packages/frame-native/test/screens.test.ts`).

Plugins can ship native code. Manifests that name native code without a mobile platform are refused (`packages/kernel/test/kernel.test.ts`), and a plugin whose native module the build lacks refuses startup (`packages/mobile/test/native-module.test.ts`). `plugins/managed-config` runs end to end on the mobile platform in Bun with a fake reader: managed values become another plugin's settings, win over launcher settings, and an undeclared key or a non-text value refuses startup. `plugins/intent-scanner` decodes broadcasts from a fake receiver through the scanner pipeline. `apps/mobile/test/entry.test.ts` checks that `mobile:prepare` hands each config plugin the application and every declared setting. `expo prebuild --platform android`, run once by hand on the fixture with managed-config composed temporarily, wrote `res/xml/app_restrictions.xml` and the `APP_RESTRICTIONS` meta-data, and `expo-modules-autolinking resolve` found both plugins' Kotlin modules.

Phones and tablets pair with a hub. `plugins/device-link/test/link.test.ts` runs a hub with `startHost` and a field app on the mobile platform in Bun, joined by the hub-link plugin and the peer connector:

- A capture taken before pairing stays pending with the reason, and a wrong code is shown on the device.
- After pairing, the photo reaches the hub before the record. A delivery whose response is lost is replayed without a second capture on the hub. A capture taken offline goes once the network returns, and a hub rejection reaches the device with its code. Assignments arrive through the hub's feed.
- A phone can call only the sync operations. A revoked phone is refused as a credential, and its records stay pending until it pairs again. A tablet works as the person who enrolled it, within the operations chosen at enrollment, and cannot be granted device management (`test/scenarios.test.ts`).
- Codes are single-use, expire, and are throttled after repeated failures.

`plugins/hub-link/test/network.test.ts` checks that the device credential goes only to the paired origin, with redirects refused.

**Not shown.** Pairing has not run on a device, the native pairing screen has not rendered, and the device credential has not been stored in a real Keychain or Keystore. There is no QR pairing. The mobile platform has not run on a device: the Expo SQLite driver, file blob store, lock and background task are untested, and the globals check has not run under Hermes. The native frame and components have not rendered. The plugins' Kotlin and Swift modules have not been compiled: no Android or iOS build has been produced, and nothing has run on an emulator, simulator or device. Test DPC restrictions, `simctl` managed configuration and `adb` scan broadcasts are the planned on-demand checks.

### OS integration

**Shown, deterministic.**

- Declarations: modules and host components declare OS handlers and OS actions. The catalog validates them (`packages/contracts/test/os.test.ts`), and the security manifest and data-flow document list them (`plugins/compliance/test/compliance.test.ts`). The URL scheme comes from the application identity and refuses reserved schemes (`packages/host/test/config.test.ts`).
- Matching and generation: request parsing, link and file matching, target templates, open-URL and file-path construction, and the native, desktop and web registrations (`packages/shell/test/shell.test.ts`).
- The shell port: the kernel default refuses every call (`packages/kernel/test/shell.test.ts`). With the OS plugin, a fixture application served over HTTP delivers a link and a text file to the submitting session only, refuses unknown, malformed, disabled and rate-limited requests, logs no content, returns an open action to a page, relays it to an attached adapter, and refuses startup for an unserved kind (`plugins/os/test/os.test.ts`). Deliveries are per session, expire and are revalidated (`packages/adapters/src/ui-deliveries.test.ts`).
- Desktop adapter, without Electron: command lines with and without `--`, injected switches, UNC and relative paths, second-instance data, input buffered until connect, undeclared files left unread, a blob file uploaded before it is submitted, relayed actions checked against the declarations again, and page opens with and without the shell port (`packages/shell/test/desktop.test.ts`). The ChatGPT authorization URL is one the declared `openai.authorize` action builds, and a changed flow, endpoint, callback or extra parameter is not (`packages/agents/test/requirements.test.ts`).
- Blob payloads: a file handler finds its handler by extension or media type, sends text inline and uploads a blob first as a declared media type, and the matcher refuses a blob over the limit or of an undeclared or mismatched media type (`packages/shell/test/files.test.ts`).
- Project tasks over HTTP: a task link opens its task, a Markdown file prefills `task.create` without committing, and adding it twice with one key adds one task. An uploaded image prefills a task with its reference; it is unreadable until the person adds the task, a forged reference is refused, and the added task serves the bytes (`examples/project-tasks/test/os.test.ts`).

- Browser landing: a landing URL with exactly one `os` or `os-shortcut` parameter becomes a request (`packages/shell/test/desktop.test.ts`), and the host serves that one cross-site navigation as a page while it refuses other cross-site requests, other paths, extra parameters, frames and fetches (`plugins/os/test/os.test.ts`).
- Browser, Chromium (`examples/project-tasks/e2e/os.pw.ts`): the served web manifest carries the protocol and file handlers; a `?os=` landing with a task link opens that task's project, shows where it came from and clears the address; a submitted Markdown file shows the prefilled task with its provenance, and adding it creates the task; an uploaded image shows its attachment in the prefill, and the added task links to bytes the page can download.
- Mobile, with Bun bindings for the device (`plugins/os/test/mobile.test.ts`): a fixture application on the mobile authority with the OS plugin holds a launch link until the frame subscribes, then delivers later links and files. A `content:` text file without an extension matches by its media type and is read once. An undeclared type is never read, and another app's scheme and an unreadable note show nothing. A PDF is staged in the blob store and prefills the form with its reference, and one over the limit is not read. A declared open action runs through the device. Without the OS plugin nothing attaches.
- Native frame (`packages/frame-native/test/os-deliveries.test.ts`): a delivery opens the declared screen, the screen the resource resolver names, or the form that binds the prepared command, and a target no screen declares opens nothing.
- Native registrations (`apps/mobile/test/entry.test.ts`): `mobile:prepare` writes the scheme, intent filters, associated domains and document types from the OS declarations and the configured link hosts into `native.json`, and passes the OS plugin settings in the entry. Association files for verified links come from `scripts/os-associations.ts`, which refuses a malformed team id or certificate fingerprint and an application without verified links (`packages/shell/test/associations.test.ts`).

**Not shown.** Nothing has been registered with, received from or performed through a real OS: the Electron wiring (`apps/desktop/src/os-shell.ts`) has no native run, and a macOS link or file reaches it only from a packaged bundle. No installed web app has registered the protocol or file handlers, the launch queue path has not run in a browser, and whether a Chromium version accepts the SVG icon for installation is not checked. `runOsAction` has no caller yet. The Expo bindings (`packages/mobile/src/expo/os-shell.ts`) have not run on a device or simulator, so no Android intent filter, iOS associated domain or document type has been registered, and no exported association file has been served from a real domain. On Android a `content:` name is often opaque, so such a file matches only by its media type. Staged uploads are lost on restart. No example targets mobile with the OS plugin.

### Layers and scaffold

**Shown, deterministic.** The boundary check resolves imports by layer, including workspace package names and the browser graph of each application. A single-example export installs with a frozen lockfile and passes its own checks. `scaffold new` generates an application that installs with a frozen lockfile; after `add collection`, `add capability` and `add target` it passes format, generation and the drift check, typecheck, build, its unit tests and a Playwright spec that creates, opens and edits a record through the default screens (`bun run test:scaffold:full`, 17 October 2026).

**Limits.** Framework packages are unpublished, so an export copies `packages/*` and depends on them through `workspace:*`. An authority hosts one application. A generated application's export fails `check:boundaries` on the reference examples' stale exemptions, so its acceptance run does not include them.

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

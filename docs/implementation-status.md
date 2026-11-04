# Implementation status

What has actually run, and what has not. No release exists yet. "Browser" means Playwright in Chromium against the real host. "By hand" means a one-off run, mostly on macOS arm64 in October 2026. "Live" means a real model, device or system of record.

| Area                                                            | Proven                                                     | Not yet                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| [Catalog, runtime and storage](#catalog-runtime-and-storage)    | Commit timings on 20,000 records; triggered agent, live    | Encryption at rest                                         |
| [Hosted instance](#hosted-instance)                             | Postgres lease and fencing, by hand                        | Public TLS, real orchestrator, Linux                       |
| [Fleet agent](#fleet-agent)                                     | Enroll, report, stage a release, browser and by hand       | Real network, activated release                            |
| [Telemetry](#telemetry)                                         | OTLP JSON against a fixture collector                      | A real collector                                           |
| [Bundles](#bundles)                                   | Create, verify, admit, by hand                             | Verify at launch, cross-platform builds                    |
| [Install](#install)                                             | Install to a staged prefix, by hand                        | `--apply` on a real host, Windows                          |
| [Application lifecycle](#application-lifecycle)                 | Best-before warning, by hand                               | Browser test                                               |
| [Workforce sign-in](#workforce-sign-in)                         | Fake and stand-in providers in tests                       | A real identity provider                                   |
| [Station sign-in](#station-sign-in)                             | Badge and PIN in tests and in Chrome                       | A physical badge reader                                    |
| [State migrations](#state-migrations)                           | Declared in most examples                                  | Keeping data of a removed feature                          |
| [Workflows](#workflows)                                         | Unit tests                                                 | Browser test, multi-day run                                |
| [Authorization and live queries](#authorization-and-live-queries) | Tests                                                    | Device and peer revocation during a request                |
| [Surfaces](#surfaces)                                           | Five apps in the browser                                   | —                                                          |
| [Agents and providers](#agents-and-providers)                   | Gemma 4 E4B on llama.cpp, live                             | ChatGPT, Claude, AI SDK inference                          |
| [Execution host](#execution-host)                               | bubblewrap in a Linux container                            | x86-64, glibc, macOS, Windows, a harness inside it         |
| [Systems of record](#systems-of-record)                         | Fakes and a loopback LIMS                                  | Any real ERP, CRM, EAM or LIMS                             |
| [Peer applications](#peer-applications)                         | Two apps on loopback, by hand                              | Two machines                                               |
| [Assignments](#assignments)                                     | People and peers in the browser                            | Agent assignee on a model                                  |
| [Connector plugins](#connector-plugins)                         | OPC UA, MQTT, file exchange against local servers          | Real equipment, network shares                             |
| [Operator workstation bridge](#operator-workstation-bridge)     | Fake HMI in the browser                                    | Real scanner, OCR or vision model                          |
| [Hardware drivers](#hardware-drivers)                           | Python driver on a simulated instrument                    | Real equipment, Windows, Linux                             |
| [Security and compliance](#security-and-compliance)             | Live denials on the Compliance screen                      | Loaded firewall rules, live network guard traffic                         |
| [Desktop](#desktop)                                             | An older unsigned macOS package                            | Current package, other platforms, signing                  |
| [Mobile](#mobile)                                               | Expo prebuild and export, tablet web frame                 | Any device, emulator or native build                       |
| [OS integration](#os-integration)                               | Web manifest, launch URLs, share target in the browser     | Anything through a real OS                                 |
| [Layers and scaffold](#layers-and-scaffold)                     | Exports install, build and pass tests                      | npm publication                                            |

## By area

### Catalog, runtime and storage

- **Proven:** 20 one-record commits on 20,000 records (about 5 MB): row storage 26–30 ms per commit, one document 46–52 ms. A triggered agent requested approval on a real local model.
- **Limits:** row storage serializes every row to find the change, so commit CPU grows with state. The instance keeps receipts by default. The phone's snapshot storage has no rows or retention. No encryption at rest.

### Hosted instance

- **Proven (by hand, 18 and 27 Oct):** against Postgres 17, two pools raced for one workspace lease and one won. A second `serve --hosted-workspace` got `CONFLICT` (exit 5). After the holder paused or stopped, a new instance took the lease with fencing token 2. `showcase/patterns/hosted` signed in against a stand-in identity provider, driven with curl.
- **Not yet:** a hosted instance behind public TLS with workforce OIDC; a real orchestrator; Linux; a paused holder's commit caught by the fence in a live run.
- **Limits:** one process serves one workspace. Run history, workforce sessions, the audit log and plugin files stay in the local directory; blobs are in the database, tested on PGlite only. `sync`, `drain`, `backup`, `restore`, `migrate` and `--embedded` open a local workspace only. No Cloudflare Durable Object host.

### Fleet agent

- **Proven:** `showcase/examples/fleet/e2e/fleet.pw.ts` covers enrollment, an instance report, channels and drift. By hand, the fleet agent pattern (port 4359) and the fleet (port 4340) ran side by side: enroll, report, forward the audit log, publish a signed 46-file release to `lab-stable` and stage it.
- **Not yet:** an instance reporting to a fleet across a real network through an outbound-only firewall; a staged release activated by `app install` with a loaded service.
- **Limits:** the relay polls every 2 s and forwards one request at a time, bodies up to 1 MiB, no event streams. Nothing rotates instance credentials. No resumed downloads. A failed cycle leaves no log or report. Staged files keep mode 0644. The fleet screens show raw millisecond times.

### Telemetry

- **Proven:** OTLP/HTTP JSON checked against the spec with a loopback fixture collector.
- **Not yet:** a real OpenTelemetry Collector or backend.
- **Limits:** each export rereads the audit log, so exports slow as it grows. Counters reset on restart. Metrics and traces only, no logs.

### Bundles

- **Proven (by hand):** `bun run bundle create` built 46-file bundles (69 MB and 92 MB) with contract, security manifest, SBOM and best-before date. `verify` accepted them; `admit` refused them until approved.
- **Not yet:** verification at launch; archives (bundles are directories); signed approvals; cross-platform builds on their targets.

### Install

- **Proven (by hand, 27 Oct):** `app install` from the fleet agent's staging folder with `--prefix --service systemd` and no `--apply` rendered the unit and `network.nft`. `app status` verified the release. `app uninstall --purge --trust` drained and removed it. A CI job (`deployment-install`, Ubuntu) runs `systemd-analyze verify` and `nft -c -f` but has not run yet.
- **Proven (by hand, 3 Nov, macOS arm64):** `showcase/examples/tool-store` with `deployment-policy.store-terminal.json`. `bundle create` built a 48-file `darwin-arm64` bundle. `verify` accepted it, and `admit` refused it until approved. The bundled binary's `install --prefix --service none` placed the release and the policy, migrated an empty workspace, and rendered no service or firewall file. `status` verified the release. `drain` exited 0 with nothing pending for `eam`. `uninstall --purge --trust` without `--apply` removed the release and the data.
- **Not yet:** `--apply` loading a service or firewall on Linux or Windows; the Windows path beyond rendering; kiosk mode; purge with undelivered effects.

### Application lifecycle

- **Proven (by hand):** a CLI built on 1 Jan 2026 with a best-before date of 30 Jun 2026 showed the expiry notice, still committed, and `compliance report` marked `best-before` as `warn`.
- **Not yet:** a Playwright spec for the notice; a best-before date reported to a fleet over a real network.
- **Limits:** `network export` alone names the application ID as socket owner, while `app install` runs as `tortoise`. Pass `--user` when exporting separately.

### Workforce sign-in

- **Proven:** tests cover PKCE, one-use state, session expiry, ID-token checks, cookie-vs-bearer handling and sign-in through the network guard with a throwaway CA.
- **Not yet:** a real identity provider.
- **Limits:** the host refuses endpoints on another origin than the issuer (such as Google's). Sessions survive a restart only on the same local directory.

### Station sign-in

- **Proven:** `workstations/sign-in/test/sign-in.test.ts` covers badge and PIN, lockout, expiry, one session per terminal, badge revocation, and no badge or PIN in the database. By hand in Chrome, `showcase/patterns/sign-in` ran with keyboard-wedge badges. In the browser, `showcase/examples/tool-store` signs attendants in at its counter terminal with the badge typed as a key burst, refuses a viewer's check-out, and signs out after five idle minutes on the page's clock.
- **Not yet:** a physical badge reader.
- **Proven (browser, 4 Nov):** at the counter terminal of `showcase/examples/tool-store`, a reload keeps the attendant signed in.
- **Limits:** signing in does not take screen control from an agent. A badge revoked during a request ends the operator's session at the next request, not during that one.

### State migrations

- **Proven:** most examples and `showcase/patterns/operations` declare state migrations.
- **Not yet:** crm-capture, fleet and quality-inspection still use unversioned `upgradeState`. No target port maps effects by `contractVersion`. The phone has no staged `migrate`.
- **Limits:** removing a feature or plugin drops its data at the next commit.

### Workflows

- **Not yet:** a browser test of the workflows screen; a multi-day run.
- **Limits:** steps run in order, no branches or parallel steps. Only a serving host makes progress. A step commits whole. A changed definition stalls running instances.

### Authorization and live queries

- **Proven:** `packages/adapters/src/http-credentials.test.ts` revokes a host session, and aborts a plugin credential's signal, inside a command's handler; the command returns `CANCELLED` and commits nothing. Workforce sign-out and operator sign-out abort their sessions' signals.
- **Limits:** a plugin credential stops a running request only when the plugin sets a signal on the context it resolves. Paired-device and peer credentials set none, so their revocation applies at the next request.

### Surfaces

- **Proven (browser or by hand in Chrome):** field-service (live updates from an MCP process, drafts, paging), quality-inspection (keyboard capture, conflicting drafts), crm-capture (search, follow, log), review (approvals, revisions, signatures), signals (OPC UA and Sparkplug B readings from a plant stand-in).
- **Proven (browser, 4 Nov):** `showcase/patterns/base/e2e/export-and-print.pw.ts` exports 120 test requests as one CSV over two list pages and checks the print layout with print media emulated in headless Chromium.
- **Not yet:** No one has printed a record screen on paper or opened an export in Excel or LibreOffice. A CSV export reads the whole list into the page before the download, with no row limit. No label printing, XLSX or PDF.
- **Not yet:** Parts desk dictation against a real microphone. The browser test plays a stub recognizer. On 3 Nov Chrome and Playwright's full Chromium reported on-device English as downloadable, and Playwright's headless shell crashed the page on `SpeechRecognition.available` ([Parts desk README](../showcase/examples/parts-desk/README.md#dictation-with-a-real-microphone)).

### Agents and providers

- **Proven (live, 18 Oct):** Gemma 4 E4B-it Q4_0 on llama.cpp `llama-server`, Apple M3. `plugins/model-server/test/live.test.ts` passed 5 of 5 (22–31 s each): the model requested approval for `note.add` and the run recorded the measured digest. `plugins/automation/test/live.test.ts` passed 3 of 3 (41–68 s): a trigger started `lot.reviewer`, a viewer's approval failed and an inspector's committed.
- **Partly proven (browser, live, 3 Nov):** the parts desk assistant panel on Gemma 4 E4B-it Q4_0 (`sha256:a555b900…f2097f2`) through `llama-server`, Apple M3, a base model with no adapter and no gate. Five turns took 65–199 s each. The model found the parts and filled the quote builder. It asked in text instead of through the question tool, named a quote that does not exist, and requested a discount that a supervisor cannot approve, because its base revisions named the record `<|"|>quote`. `showcase/examples/parts-desk/test/assistant-live.test.ts` failed both turns it covers. [Parts desk 4](tutorials/parts-desk-4-live-model-and-voice.mdx#live-run) records each turn.
- **Partly proven (27 Oct):** `showcase/patterns/local-model/test/live.test.ts` passed once, but the model's revision key was malformed. Two later runs timed out under heavy load.
- **Proven (browser, by hand):** `showcase/patterns/agents` and `showcase/patterns/local-model` showed approval requests and UI review on screen.
- **Proven (browser):** on the Approvals screen of `showcase/examples/tool-store`, an attendant approved one request to retire a tool, which retired it, and rejected another, which left the tool in repair. The requests came over HTTP from the owner, not from an agent run.
- **Not yet:** ChatGPT sign-in, Claude or AI SDK inference, vLLM, fine-tunes, weights as bundle artifacts. Agent scenarios have passed with the deterministic harness only.
- **Not yet:** a model following the `calibration-pull` workflow of `showcase/examples/tool-store` over MCP. Its test reads the workflow resource and calls the tools it names through the MCP adapter, with no model.
- **Proven (browser):** at the counter terminal of `showcase/examples/tool-store`, a run on the deterministic harness, started from the ticked tools, opened a tool on the Counter tab and asked for a review above its edit form. The attendant saved the bin and acknowledged the review. The run acts as the terminal's session, the owner.
- **Not yet:** a provider model at that terminal. Without an agent definition such a run has the owner's whole grant, and only its instruction keeps it from `tool.update`.
- **Proven (browser, 4 Nov):** the frame's assistant panel in `showcase/patterns/agents` ran two turns with the method suggester on the deterministic harness, from the request screen's record. The person answered its question in the panel, and after a reload the panel showed the request, the answer and the reply again (`e2e/assistant.pw.ts`).
- **Not yet:** the frame's panel on a model, and the discrepancy classifier started from the receiving panel on a model. The work order planner starts from the field-service agent panel only with a provider account. The parts desk still has its own panel, with dictation and record links; the assistant tutorial still has each application write its panel.

### Execution host

- **Proven (17 Oct):** `bun run test:execution-host:linux` passed 18 of 18 in an arm64 Alpine container with bubblewrap and the plugin's seccomp filter. On macOS the sandbox pattern shows "darwin has no backend".
- **Not yet:** x86-64, glibc, a bare host kernel, macOS or Windows backends, a harness launching its tools through the sandbox, real TLS outbound connections, distributions that restrict user namespaces.

### Systems of record

- **Proven (by hand):** `showcase/patterns/system-of-record` against its fake LIMS: register, held after six attempts, resolve as applied, reject with the LIMS's reason, import through the feed.
- **Proven (browser):** `showcase/examples/tool-store` against its fake EAM: a damaged return shows the repair order number on the tool, and with `DEMO_EAM_UNKNOWN_TAGS` the refused repair order (`ASSET_UNKNOWN`) shows as needing attention and is counted on the EAM screen. Its held repair orders are tested through the instance only.
- **Not yet:** any real ERP, CRM, EAM or LIMS; extraction on a model provider; asset-survey's live comparison.
- **Limits:** two dispatcher processes cannot share a local workspace. Capture timings are synthetic.

### Peer applications

- **Proven (by hand, 27 Oct):** receiving and quality-inspection on loopback, paired with an enrollment code. An inspection request crossed over and its outcome came back.
- **Not yet:** two machines; a browser test of the Peers screen; the mobile drift check under Hermes.
- **Limits:** no mTLS binding or key rotation. The `jti` cache is in memory. The Peers screen shows no drift. A peer target with no connection fails `sync` at that target. Receiving's lot search returns 50 lots.

### Assignments

- **Proven (browser):** `showcase/patterns/assignments/e2e/rounds.pw.ts` (person assignees) and `showcase/patterns/worklist/e2e/worklist.pw.ts` (peer assignee across two hosts).
- **Not yet:** an agent assignee on a model; an assignment target outside tests; the cycle count screens of `showcase/examples/tool-store` in a browser. Those screens act as the terminal's session, so an attendant signed in at the counter cannot work a count there.
- **Limits:** an app that fills no slots shows the brief as JSON.

### Connector plugins

- **Proven (by hand, 17 Oct):** `connector-opcua` read values from an asyncua server. `connector-mqtt` decoded Sparkplug B from an amqtt broker. `showcase/examples/receiving/e2e/receiving.pw.ts` imports a notice, posts a receipt and shows it accepted. The [receiving walkthrough](../showcase/examples/receiving/README.md) ran by hand on 28–29 Oct.
- **Not yet:** a real PLC, OPC UA gateway, Sparkplug node or broker over TLS; OPC UA security; a real network share; a real REST system.

### Operator workstation bridge

- **Proven:** `showcase/examples/winding-line/e2e/station.pw.ts` classifies a stop, starts an order, loads a recipe and blocks the bridge on takeover. `bun run station:golden` identified 5 of 5 screens from recorded expectations.
- **Not yet:** a physical scanner (the desktop shell does not grant Web Serial or WebHID); OCR or vision models; computer use over VNC, RDP or UI Automation.
- **Limits:** nothing here is safety-rated.

### Hardware drivers

- **Proven:** `showcase/examples/quality-inspection/e2e/instrument.pw.ts` runs the Python driver against a simulated instrument on a pseudo-terminal. Skipped without uv or pyserial.
- **Not yet:** real equipment; the .NET SDK on Windows (STA, COM, `win-x86`); driver tests on Linux; winding-line's served automation route; remote drivers.

### Security and compliance

- **Proven:** the Compliance screen shows a new denial without a reload.
- **Not yet:** exported firewall rules loaded into nftables, Windows Firewall, systemd or a cluster; an off-host syslog collector; live traffic through the network guard; a real workforce provider. Agent harnesses still spawn directly. The Bun platform has no secret store.

### Desktop

- **Proven:** an older source state, packaged unsigned on macOS arm64, passed the smoke and lifecycle tests. Rebuild before relying on it ([desktop](desktop.md#build-and-smoke-test)).
- **Not yet:** the current package; Windows, Linux and macOS x64; the credential vault; signing, notarization, installers and updates.

### Mobile

- **Proven (by hand):** `expo prebuild --platform android` on the fixture wrote the managed-config restrictions. `expo export --platform android` bundled the asset-survey field app. In the browser, the tablet web frame and the asset-survey hub flow pass.
- **Not yet:** anything on a device, emulator or simulator; pairing; native UI; compiled Kotlin or Swift modules.

### OS integration

- **Proven (browser):** `showcase/examples/field-service/e2e/os.pw.ts` covers the web manifest's handlers, `?os=` launch URLs, file and share-target prefill, reminders, shortcuts and `navigator.share` (replaced with a recorder).
- **Not yet:** anything through a real OS: Electron wiring, installed web apps, Expo bindings, real share sheets, real notifications, Android intents, launcher shortcuts.

### Layers and scaffold

- **Proven:** `bun run test:scaffold:full` (27 Oct, 16 tests): `scaffold new`, `add collection/capability/target`, a complete source export and an install from a loopback registry all pass their checks and Playwright specs. By hand, the [tutorials](tutorials/index.md) ran prompt by prompt from a fresh session and the [getting-started](getting-started.md) export passed its tests.
- **Proven (3 Nov):** `scripts/tutorial-run.ts` ran the 14 tool store prompts with Claude Code in an export, one step at a time, steps 1 to 6 on Sonnet and 7 to 14 on Opus. Every step passed its checks. Step 6 failed its Playwright check until `bunx playwright install chromium` restored the browser, which a process outside the run had deleted. The run needed two framework changes, both kept: `fill` on `CapabilityForm` for a scan, and the run's ID on a UI intent. The result is `showcase/examples/tool-store`.
- **Proven (3 Nov):** the same script ran the 13 parts desk prompts on Opus, and every step passed its checks. Step 12 ran on Gemma 4 E4B weights and recorded the model's failures, as its prompt asks. The run needed three framework changes, all kept: `asideButton` in `defineScreens` for the assistant panel on a compact viewport, the shell's `main` as a size container, and the intent ID passed to a `prepare` handler. The result is `showcase/examples/parts-desk`.
- **Proven (4 Nov):** with the record screens (declared filters, sort, display kinds, record-loaded edits and `null` to clear), `bun run test:scaffold:full` passed 18 tests, including the generated application's check and its Playwright spec per collection, and all 36 browser specs of the examples and patterns passed.
- **Open gaps from those runs:** The generic form takes no expected revisions or transport. The PIN keypad takes no typed digits. An agent run in a terminal acts as the terminal, not the operator. In an export, `check:skills` fails on links to omitted examples and patterns.
- **Limits:** `device-link` and the `device` feature do not compose together. No package is on npm. Packages ship TypeScript source. An instance hosts one application.

## Known defects

- An example started with `dev` or `dev:web` titles its window with the display name in `app.config.json`, such as "Field Service".
- Fixed without a regression test: Windows paths during staging, scanner default routes, scanner setup edits.

## Planned improvements

- Share event, receipt and cancellation handling between the HTTP and direct adapters.
- Extract a reusable draft model from capture and scanner setup.
- Replace `./*` wildcard exports with explicit entrypoints before 1.0.

## Out of scope

Managed cloud hosting, multi-device sync, more than one application per instance, package publication, signed distribution.

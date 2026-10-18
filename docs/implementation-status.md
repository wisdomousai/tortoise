# Implementation status

This ledger records what has been run outside `bun run check`, and what has not been shown at all. Deterministic behavior is whatever the test suites check; read the tests, not this file. The ledger describes the current source; git holds the history. No public release has been made.

The kinds of evidence are kept apart, and one never stands in for another:

- **Browser:** Playwright in Chromium against the real service (`bun run test:e2e`).
- **Native:** a packaged build or a real OS facility, on a named platform.
- **Live:** real providers, devices or systems of record, with explicitly configured accounts.
- **By hand:** a one-off run of a script or tool, with what it showed.

When a change adds or invalidates evidence, or closes a gap, edit the entry for that area.

## By area

### Catalog, runtime and storage

**Measured.** On an M-series laptop, 20 one-record commits on 20,000 records (about 5 MB): row storage 26–30 ms per commit, one document 46–52 ms.

**Live.** A triggered agent has proposed on a real local model, and a person accepted (see [Agents and providers](#agents-and-providers)).

**Not shown.** No host route starts an agent run from a definition. The line-station proposal tile and the frame's proposal review have no browser test.

**Limits.** Row storage still serializes every row to find the change, so commit CPU grows with state. Receipts are kept by default. The phone's snapshot storage has neither rows nor retention. No encryption at rest.

### Hosted authority

**By hand.** On 18 October 2026, against a throwaway Postgres 17.6 container (the `supabase/postgres` image, with a password set for the run), on macOS arm64:

- With `STORAGE_POSTGRES_URL` set, the storage conformance cases and the lease cases passed through `Bun.SQL`. Two pools raced for one lease, and one won.
- Two project-tasks instances ran `serve --hosted-workspace live-f1`, each with its own local directory. The second was refused with `CONFLICT`, and `project.create` committed through the first.
- The first was paused with SIGSTOP for 33 seconds. A new instance then took the lease with fence 2 and listed the project.
- The first was resumed. It logged `lease-lost` and exited.

**Not shown.**

- No hosted instance has run behind a public TLS listener with workforce OIDC sign-in.
- None has run under a real orchestrator, or on Linux.
- No commit from a paused holder has been caught by the fence in a live run. The resumed instance's renewal found the loss first, and the tests cover the fence.

**Limits.**

- One process serves one workspace. Many workspaces need one instance each behind a router.
- Blobs, agent run history, the audit log and the plugins' local files stay in the instance's local directory. A takeover on another machine starts without them unless that directory is on shared storage.
- The embedded CLI verbs (`sync`, `drain`, `backup`, `restore`, `migrate`, `--embedded`) open a local workspace only. Back up the database with its own tools.
- No Cloudflare Durable Object host exists. The host uses Bun APIs, and a Workers entry is not written.

### Fleet agent

**Browser.** On 18 October 2026, `examples/fleet/e2e/fleet.pw.ts` passed in headless Chromium against the real service: enrollment from the Devices screen, a site report, a channel created and assigned from the screens, and the drift shown on the Health screen.

**Not shown.**

- No site has reported to a fleet across a real network, behind a firewall that allows only outbound https.
- No staged release has been activated by `site install` from the `fleet-releases` folder on a real machine with a loaded service; the fleet-agent test does it on a staged prefix without `--apply`.

**Limits.**

- The relay polls the fleet (every two seconds by default) and forwards one request at a time, with bodies up to 1 MiB. It carries no event streams.
- A site credential is not rotated. A fleet that loses one re-enrolls the site with a new code.
- Staging fetches each release file whole. There is no resumed download.
- The fleet's Devices screen calls a `field-sync` enrollment a phone, as device-link names it; a site is enrolled with that kind.

### Telemetry

**Not shown.**

- No export has reached a real OpenTelemetry Collector or backend. The tests check the OTLP/HTTP JSON against the OTLP specification with a loopback fixture collector.

**Limits.**

- Each export rereads the audit log's segment files to find new events, so exports slow down as the log grows.
- Counters restart when the host restarts, and history from before the start is not exported.
- There are metrics and traces only, no logs.

### Site bundles

**By hand.** `bun run bundle create` built a 69 MB project-tasks bundle (46 files) on macOS arm64, which `verify` accepted and `admit` refused until approved. Rerun on 17 October 2026 after the bundle began writing its contract, security manifest and SBOM from the catalog: the signature verified and `admit` listed the requirements to approve.

**Not shown.** `site install` consumes a bundle (see [Site install](#site-install)), but nothing verifies one again at launch. Bundles are directories, not archives. Approvals are unsigned site data. No cross-platform build has been verified on its target.

### Site install

**Added, not yet run.** The `site-install` CI job on Ubuntu runs `plugins/site/test/install.test.ts` with `systemd-analyze verify` on the unit and `nft -c -f` on the rules.

**Not shown.** No `--apply` run has loaded a service or firewall on a real host, on Linux or Windows. The Windows path (WinSW XML, Windows Firewall script) has only been rendered, never run. No kiosk client mode exists.

### Workforce sign-in

**Shown, deterministic.** `plugins/site/test/workforce.test.ts` signs in against a fake provider: PKCE, a one-use state, ID-token checks (audience, nonce, verified email, the discovered issuer) and session expiry. `packages/adapters/src/http-credentials.test.ts` shows a cookie offered only as a cookie and a bearer only as a bearer. The project-tasks hardening test starts an `external` policy with a bound provider and no owner session.

**Not shown.** No real identity provider has been signed in to. Endpoints on another origin than the issuer (Google's, for example) are refused. Sessions live in memory, so a restart signs everyone out. 

### Station sign-in

**Shown, deterministic.** `plugins/station-sign-in/test/sign-in.test.ts` runs a station over HTTP and shows that:

- an operator signs in with badge and PIN and acts as themselves;
- the lockout holds even against the right PIN;
- a session expires;
- a second sign-in at the seat ends the first session;
- revoking a badge ends its sessions;
- neither the badge value nor the PIN reaches the workspace database.

**Not shown.**

- No physical badge reader has been tested, and no station screen signs people in yet.
- Signing in does not move a seat that an agent holds.

### State migrations

**Not shown.** The examples declare no migrations yet, and keep their unversioned `upgradeState`. A target port that maps effects by `contractVersion` has not been written. The phone's storage stamps versions, but has no staged `migrate`.

### Authorization and live views

**Open.** A session revoked during a request does not stop it; see [known defects](#known-defects).

### Surfaces

**Shown, browser.**

- **project-tasks:** live updates from an external MCP process, drafts that keep their base revision, and paging past the first page.
- **quality-inspection:** keyboard-only capture; a draft that keeps its sample when another caller records it first.
- **crm-capture:** search, adopt and log.

### Agents and providers

**Not shown, live.** No live ChatGPT consent, token refresh or revocation, and no Claude or AI SDK inference. No provider credentials were discovered or reused.

**Local models, live.** On 18 October 2026, on an Apple M3 laptop (macOS 26.7.1), with llama.cpp `llama-server` 0.7.0 (Homebrew build 11669) and Gemma 4 E4B-it Q4_0 (`ggml-org/gemma-4-E4B-it-GGUF`, Apache-2.0, 4,590,807,392 bytes, measured `sha256:a555b900214b477d8880e7832e0b8925e139b0159640036b09fe472b6f2097f2`):

- `plugins/model-server/test/live.test.ts` passed 5 times in 5. The plugin started the real server through the process port, measured the weights and served the `note.suggester` agent. From the task "Propose adding a note with id n1 that says "Call the supplier"", the model proposed `note.add` with that input. The run recorded the entry, the measured digest and `verified: true`. Each run took 22–31 seconds, including the server start.
- `plugins/automation/test/live.test.ts` passed 3 times in 3. A received lot started the `lot.reviewer` run through its trigger and standing grant; the model read the lot, then proposed `lot.inspect` for `l1`. A viewer's accept was refused, and an inspector's accept committed the inspection. Each run took 41–68 seconds.

The runs found these defects, now fixed and covered by deterministic tests:

- A tool envelope nested a recursive input schema's `$defs`, so llama.cpp refused the tool (`cannot resolve $ref`). `toolEnvelopeSchema` moves them to the root.
- A proposing agent's model was never told which commands it may propose or their inputs, and a trigger run's prompt left out the agent's instructions. Both now start with `agentInstructions`.
- An application refusal or a malformed call ended an AI SDK run. The model now reads the error and may correct the call.
- `expectedRevisions` was offered on queries and `proposal.submit`, where it means nothing, and models filled it with invented keys.
- The egress guard's 30-second request timeout cut off a model that reasons before it answers. A destination binding now takes `timeoutMs`.

Qwen2.5-1.5B-Instruct Q4_K_M failed the note scenario in every run before these fixes, and was not rerun after them. No vLLM and no fine-tune has run. Weights are not yet delivered as bundle artifacts.

**Agent scenarios, live.** Gemma 4 E4B-it Q4_0 on llama-server 0.7.0: the model server's `proposes a note on a real model` passed (see above). The scenarios in `packages/testing` and `examples/receiving` have passed with the deterministic harness only.

### Execution host

**Native.** 17 October 2026, `bun run test:execution-host:linux` on Docker Desktop 29.4.0 (Linux 6.12.76-linuxkit, arm64), with `IMAGE` naming an image assembled by hand from a locally cached Alpine 3.23 base with bubblewrap 0.12.0 and Bun 1.4.0 (musl): all 18 tests passed, including the eight in `test/sandbox.test.ts` under real bubblewrap and the plugin's seccomp filter. `test/linux/Dockerfile` itself was not built here, because Docker Desktop's image pulls hung behind its proxy.

**Not shown.**

- **Platforms:** no run on x86-64, on glibc, or on a host kernel outside a container; no macOS or Windows backend exists.
- **Agents:** no coding agent harness (Codex, Claude Code) has run inside a sandbox; the tasks were the probe script, the application CLI and an MCP client.
- **Egress:** the proxy path was shown to a loopback listener, not to a real provider over TLS.
- **Distributions** that restrict unprivileged user namespaces (Ubuntu's AppArmor rule, a disabled sysctl) were not tried.

### Systems of record

**Not shown.** Delivery, sync and remote queries run only against in-memory fakes: in quality-inspection, crm-capture and asset-survey (the demo EAM, and an extractor that reads text embedded in generated nameplate images). [Remote queries](primitives.md#remote-query) and [data providers](primitives.md#data-provider) are used by crm-capture and asset-survey. There is no real system of record, CRM or EAM, and no extraction has run against a model provider: asset-survey's model extractor has run only against a mock model and a fake network port, and its live comparison over the six sample plates (`examples/asset-survey/test/live-extraction.test.ts`) has not run. The asset-survey export directory is written by a real child process in its test, not by a deployed site. Two dispatcher processes cannot share a local workspace: the OS lock refuses the second (`packages/adapters/src/ownership.test.ts`), so dispatchers race only within one process, which the reliability tests cover, or across hosted instances under the fenced lease. Capture timings come from synthetic runs.

### Connector plugins

**By hand.** 17 October 2026, on macOS, against independent implementations started from the uv cache:

- `connector-opcua`'s client against an asyncua 2.1.0 server on loopback: an anonymous session with security policy None read a Double, a String, an Int32, a UInt64 above 2^53, an array (reported unsupported), the server's current time (`i=2258`) and an unknown node (bad status), then closed the session and channel.
- `connector-mqtt`'s observer against an amqtt 0.12.1 broker, with a paho-mqtt 2.1.0 publisher encoding Sparkplug B with protobuf 7.36.2 from the Eclipse Tahu schema: a node birth, then data by alias, became the readings `temp` 72.25 and `count` -7, both `observed`.

**Shown, browser.** `examples/receiving/e2e/receiving.pw.ts` on macOS: the real service with a site policy binding the three ERP exchange folders to temporary directories. The notice is imported from the inbox, a line is counted, classified and posted, the goods receipt file appears in the drop folder, the test answers as the ERP with a receipt file, and the ERP screen shows it accepted. A second spec, run the same day, leaves the receipt unreadable: the Held receipts screen shows the held goods receipt with the reason, and recording it as applied empties the list and counts it accepted on the ERP screen.

**Not shown.**

- **Equipment:** no real PLC, OPC UA gateway, Sparkplug edge node or plant broker, and no broker over TLS or with credentials.
- **OPC UA security:** signed and encrypted channels and user sign-in are not implemented, so a server that requires them is refused.
- **Files:** no real network share, SMB or NFS mount, or other system writing receipts; the exchange has run only against temporary directories and the fake consumer.
- **HTTP:** no real REST system of record; only the loopback fake.

### Operator workstation bridge

**Shown, browser.** In `line-station`, against the real service and a separate fake HMI process:

- a stop is classified;
- an order is scanned and started with a hold;
- the recipe is loaded and read back;
- takeover blocks the bridge.

The kit's interaction tests also pass.

**By hand.** `bun run station:golden`, 8 October 2026: 5 of 5 screens identified with no confident misread, against recorded expectations rather than a model, which checks the wiring only.

**Not shown.**

- **Hardware:** no physical scanner has been checked, and the desktop shell does not grant Web Serial or WebHID.
- **Models:** no local OCR or vision model has been called.
- **Computer use:** there is no live computer-use driver, and no VNC, RDP or UI Automation transport.
- **Safety:** nothing here is safety-rated or validated.

### Hardware drivers

**Shown, browser.** `examples/quality-inspection/e2e/instrument.pw.ts` on macOS: the real service with a site policy binding the Python instrument driver, which reads a simulated instrument over a pseudo-terminal pair; the inspector uses the reading as a result. It is skipped where uv or a cached pyserial is missing.

**Not shown.**

- **Equipment:** no physical instrument, controller or station software has been connected. The instrument driver has run only against its pseudo-terminal simulator, and the station automation driver only against its simulated station.
- **Windows:** the .NET SDK's STA handler thread, COM interop and a `win-x86` build have not run. The line-station `ComStation` has never run, and its member names are an assumed object model, not a real vendor's.
- **Linux:** the Python and .NET driver tests have run only on macOS.
- **Served automation route:** line-station's automation route has run only in tests that start the driver directly; a served host starting it through the process plugin from a site binding (`STATION_ROUTE=automation`) has not run.
- **Not built:** a remote transport for a driver on another machine, live non-journaled readings, remote queries over driver state, Android native-module drivers and a C++ SDK.

### Security and compliance

**Shown, browser.** The Compliance screen shows a new denial without a reload.

**Not shown.**

- **Rules:** the exported rules are compared as text only. They were never loaded into nftables, Windows Firewall, systemd or a cluster.
- **Live traffic:** no off-host syslog collector, and no live provider traffic through the guard.
- **Zero trust:** it starts only with a workforce provider bound; no real provider has been signed in to (see [workforce sign-in](#workforce-sign-in)).
- **Processes:** the agent harness launches still spawn directly, not through the process port. The Bun platform has no secret store, so processes that declare secrets are unavailable there. Tree termination has not run on Windows.

Control mappings are indicative, not a certification.

### Desktop

**Shown, native, outdated.** An earlier source state was staged and packaged unsigned on macOS arm64, from before the system-of-record, frontend and CLI changes. It passed the offline smoke test and the Electron owned and attached lifecycle tests. Rebuild and rerun them before relying on a packaged build ([desktop](desktop.md#build-and-smoke-test)).

**Not shown.**

- the current packaged build;
- Windows x64, Linux x64 and macOS x64, which are configured in CI but have not run;
- credential-vault set, get and delete on any platform;
- signing, notarization, installers and updates.

### Mobile

**By hand.** `expo prebuild --platform android`, run once on the fixture with managed-config composed temporarily, wrote `res/xml/app_restrictions.xml` and the `APP_RESTRICTIONS` meta-data, and `expo-modules-autolinking resolve` found both plugins' Kotlin modules. Autolinking also found an Expo module in a workspace plugin through the root `node_modules`, checked against a temporary probe module. On 2026-10-17, with the asset-survey field app prepared (`AGENT_NATIVE_MOBILE_APPLICATION=@agent-native/asset-survey-field bun run mobile:prepare`), `expo export --platform android` bundled it: Metro resolved its native screens, `expo-camera`, `expo-file-system` and the hub-link, managed-config and intent-scanner entries. `expo config --type introspect` on the same entry showed the `expo-camera` config plugin applied from the manifest's `expoPlugins`: the iOS camera usage description, no microphone description, and only Android's `CAMERA` permission.

**Shown, browser.** The web frame on a tablet-sized viewport (`tests/e2e/compact-shell.pw.ts`, Chromium with touch): the sidebar becomes a bar with a menu sheet that closes on navigation, the capability palette opens, and the sidebar returns at desktop width. The asset-survey hub (`examples/asset-survey/e2e/survey.pw.ts`): the full flow from structure through review to filing, with a device paired over HTTP, and the compact review queue at 768×1024.

**Not shown.** Pairing has not run on a device, the native pairing screen has not rendered, and the device credential has not been stored in a real Keychain or Keystore. There is no QR pairing. The hub screens have not been opened in a WebView on a device, so the WebView settings (navigation refusal, no new windows, private cookie store, camera prompt) are unverified. The mobile platform has not run on a device: the Expo SQLite driver, file blob store, lock and background task are untested, and the globals check has not run under Hermes. The native frame and components have not rendered. The plugins' Kotlin and Swift modules have not been compiled: no Android or iOS build has been produced, and nothing has run on an emulator, simulator or device. The asset-survey field app's screens have not rendered: taking photos, finding a node from a scan, and pairing from managed configuration have run only as the Bun pipeline test without the native plugins. Test DPC restrictions, `simctl` managed configuration and `adb` scan broadcasts are the planned on-demand checks.

### OS integration

**Shown, browser.** `examples/project-tasks/e2e/os.pw.ts`: the served web manifest carries the protocol and file handlers; a `?os=` landing with a task link opens that task's project, shows where it came from and clears the address; a submitted Markdown file shows the prefilled task with its provenance, and adding it creates the task; an uploaded image shows its attachment in the prefill, and the added task links to bytes the page can download. A share target form posted cross-site from a blank page, first with a link and then with a PNG, lands on the app, shows the prefilled task with its provenance, and the added task is created. A reminder asked for in the page shows as waiting for the desktop or phone app. The web manifest lists the New task shortcut, and its landing shows an empty prefilled task opened from a shortcut.

**Not shown.** Nothing has been registered with, received from or performed through a real OS: the Electron wiring (`apps/desktop/src/os-shell.ts`) has no native run, and a macOS link or file reaches it only from a packaged bundle. No installed web app has registered the protocol or file handlers, the launch queue path has not run in a browser, and whether a Chromium version accepts the SVG icon for installation is not checked. `runOsAction` has no caller yet. The Expo bindings (`packages/mobile/src/expo/os-shell.ts`) have not run on a device or simulator, so no Android intent filter, iOS associated domain or document type has been registered, and no exported association file has been served from a real domain. No share has come from a real share sheet: the Chromium test posts the share target form itself, and `expo-sharing`, whose receiving API is experimental, has not run on a device, so its Android SEND filter and iOS share extension are unbuilt. The macOS share menu has not opened. On Android a `content:` name is often opaque, so such a file matches only by its media type. Staged uploads are lost on restart. No example targets mobile with the OS plugin. No notification has been shown by a real OS: the Electron `Notification` path has no native run, and its action buttons appear only on macOS and Windows, and whether macOS shows them for an unsigned build is unchecked. `expo-notifications` has not run on a device, so the permission prompt, the categories, a reply after the app was stopped and `requiresUnlock` on iOS are unchecked. Text replies are not passed on. A web page shows no notifications. The Android intent module (`plugins/android-intents/android`) has not been compiled, and no intent has been received or started on a device: the intent filter config plugin (`packages/mobile/intent-filters.plugin.cjs`) has not run in a prebuild, and an `am start` with a declared action is unchecked. A sender's extras of a type the app cannot unpack drop all extras of that intent. No launcher has shown a shortcut: the macOS dock menu and the Windows jump list (`apps/desktop/src/os-shell.ts`) have no native run, the Android shortcuts config plugin (`packages/mobile/shortcuts.plugin.cjs`) has not run in a prebuild, and no installed web app has offered its manifest shortcut. Linux has no desktop actions, because the `dir` target writes no desktop file, and iOS has no quick actions.

### Layers and scaffold

**Opt-in run.** `bun run test:scaffold:full`, 17 October 2026: `scaffold new` generates an application that installs with a frozen lockfile; after `add collection`, `add capability` and `add target` it passes format, generation, typecheck, build, its unit tests and a Playwright spec that creates, opens and edits a record through the default screens.

**Opt-in run, complete export.** `bun run test:scaffold:full`, 17 October 2026: the complete source export installs frozen, passes format, typecheck, generation, build and its 810 tests (the driver SDKs, .NET projects and certificate fixture are now exported), and an authored capability with its policy rule answers over the exported HTTP host.

**Opt-in run, installed framework.** `bun run test:scaffold:full`, 17 October 2026: the framework packs into 39 tarballs served by the loopback registry; `scaffold new --registry` exports without framework source; the export installs, reinstalls with `--frozen-lockfile` from a clean `node_modules`, adds a target with the installed scaffold and passes its whole `bun run check` and its Playwright spec.

**By hand, mobile export.** 17 October 2026: `bun run scaffold <dir> --name field-survey --example asset-survey-field` exports `apps/mobile`, the field app and the hub example it imports. In the export, a frozen install, `bun run typecheck`, `bun test examples`, `bun run mobile:prepare` (the native config lists the managed-config and `expo-camera` config plugins) and `expo export --platform android` (a Hermes bundle) pass. `test:scaffold:full` does not repeat the mobile steps, and no native build was made from the export.

**Limits.** No framework version has been published to npm or any real registry; every install from versions ran against the loopback registry (`release:serve`). The packages are MIT licensed, but publishing to a public registry needs an account for it. The packages publish TypeScript source, and only Bun and Vite have consumed them. An example export still copies the framework. An authority hosts one application.

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
- Before a 1.0 version, replace the `./*` wildcard exports with explicit entrypoints: today every source file of a package is a public entrypoint.

## Out of scope

- managed cloud hosting (the hosted platform runs on any server with Postgres; no provider is targeted) and multi-device synchronization;
- more than one application per authority;
- package publication;
- signed distribution.

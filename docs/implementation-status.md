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

**Not shown.** No host route starts an agent run from a definition. No agent trigger has run against a model, and no real local model server has been run. The line-station proposal tile and the frame's proposal review have no browser test.

**Limits.** Row storage still serializes every row to find the change, so commit CPU grows with state. Receipts are kept by default. The phone's snapshot storage has neither rows nor retention. No encryption at rest.

### Site bundles

**By hand.** `bun run bundle create` built a 69 MB project-tasks bundle (46 files) on macOS arm64, which `verify` accepted and `admit` refused until approved. Rerun on 17 October 2026 after the bundle began writing its contract, security manifest and SBOM from the catalog: the signature verified and `admit` listed the requirements to approve.

**Not shown.** No installer consumes a bundle yet, and nothing verifies one at launch. Bundles are directories, not archives. Approvals are unsigned site data. No cross-platform build has been verified on its target.

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

**Not shown.** `migrate` is not yet run by a bundle install; that comes with `site install`. The examples declare no migrations yet, and keep their unversioned `upgradeState`. A target port that maps effects by `contractVersion` has not been written. The phone's storage stamps versions, but has no staged `migrate`.

### Authorization and live views

**Open.** A session revoked during a request does not stop it; see [known defects](#known-defects).

### Surfaces

**Shown, browser.**

- **project-tasks:** live updates from an external MCP process, drafts that keep their base revision, and paging past the first page.
- **quality-inspection:** keyboard-only capture; a draft that keeps its sample when another caller records it first.
- **crm-capture:** search, adopt and log.

### Agents and providers

**Not shown, live.** No live ChatGPT consent, token refresh or revocation, and no Claude or AI SDK inference. No provider credentials were discovered or reused.

### Systems of record

**Not shown.** Delivery, sync and remote queries run only against in-memory fakes: in quality-inspection, crm-capture and asset-survey (the demo EAM, and an extractor that reads text embedded in generated nameplate images). [Remote queries](primitives.md#remote-query) and [data providers](primitives.md#data-provider) are used by crm-capture and asset-survey. There is no real system of record, CRM or EAM, and no extraction has run against a model provider; asset-survey has no live extractor yet. Two dispatcher processes racing for one workspace (rather than two dispatchers in one process) and a reconciliation query across targets are not shown. Capture timings come from synthetic runs.

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

**By hand.** `expo prebuild --platform android`, run once on the fixture with managed-config composed temporarily, wrote `res/xml/app_restrictions.xml` and the `APP_RESTRICTIONS` meta-data, and `expo-modules-autolinking resolve` found both plugins' Kotlin modules. Autolinking also found an Expo module in a workspace plugin through the root `node_modules`, checked against a temporary probe module. On 2026-10-17, with the asset-survey field app prepared (`AGENT_NATIVE_MOBILE_APPLICATION=@agent-native/asset-survey-field bun run mobile:prepare`), `expo export --platform android` bundled it: Metro resolved its native screens, `expo-camera`, `expo-file-system` and the hub-link, managed-config and intent-scanner entries.

**Shown, browser.** The web frame on a tablet-sized viewport (`tests/e2e/compact-shell.pw.ts`, Chromium with touch): the sidebar becomes a bar with a menu sheet that closes on navigation, the capability palette opens, and the sidebar returns at desktop width. The asset-survey hub (`examples/asset-survey/e2e/survey.pw.ts`): the full flow from structure through review to filing, with a device paired over HTTP, and the compact review queue at 768×1024.

**Not shown.** Pairing has not run on a device, the native pairing screen has not rendered, and the device credential has not been stored in a real Keychain or Keystore. There is no QR pairing. The hub screens have not been opened in a WebView on a device, so the WebView settings (navigation refusal, no new windows, private cookie store, camera prompt) are unverified. The mobile platform has not run on a device: the Expo SQLite driver, file blob store, lock and background task are untested, and the globals check has not run under Hermes. The native frame and components have not rendered. The plugins' Kotlin and Swift modules have not been compiled: no Android or iOS build has been produced, and nothing has run on an emulator, simulator or device. The asset-survey field app's screens have not rendered: taking photos, finding a node from a scan, and pairing from managed configuration have run only as the Bun pipeline test without the native plugins. Its build does not apply the `expo-camera` config plugin, so an iOS build lacks the camera usage description. Test DPC restrictions, `simctl` managed configuration and `adb` scan broadcasts are the planned on-demand checks.

### OS integration

**Shown, browser.** `examples/project-tasks/e2e/os.pw.ts`: the served web manifest carries the protocol and file handlers; a `?os=` landing with a task link opens that task's project, shows where it came from and clears the address; a submitted Markdown file shows the prefilled task with its provenance, and adding it creates the task; an uploaded image shows its attachment in the prefill, and the added task links to bytes the page can download. A share target form posted cross-site from a blank page, first with a link and then with a PNG, lands on the app, shows the prefilled task with its provenance, and the added task is created. A reminder asked for in the page shows as waiting for the desktop or phone app. The web manifest lists the New task shortcut, and its landing shows an empty prefilled task opened from a shortcut.

**Not shown.** Nothing has been registered with, received from or performed through a real OS: the Electron wiring (`apps/desktop/src/os-shell.ts`) has no native run, and a macOS link or file reaches it only from a packaged bundle. No installed web app has registered the protocol or file handlers, the launch queue path has not run in a browser, and whether a Chromium version accepts the SVG icon for installation is not checked. `runOsAction` has no caller yet. The Expo bindings (`packages/mobile/src/expo/os-shell.ts`) have not run on a device or simulator, so no Android intent filter, iOS associated domain or document type has been registered, and no exported association file has been served from a real domain. No share has come from a real share sheet: the Chromium test posts the share target form itself, and `expo-sharing`, whose receiving API is experimental, has not run on a device, so its Android SEND filter and iOS share extension are unbuilt. The macOS share menu has not opened. On Android a `content:` name is often opaque, so such a file matches only by its media type. Staged uploads are lost on restart. No example targets mobile with the OS plugin. No notification has been shown by a real OS: the Electron `Notification` path has no native run, and its action buttons appear only on macOS and Windows, and whether macOS shows them for an unsigned build is unchecked. `expo-notifications` has not run on a device, so the permission prompt, the categories, a reply after the app was stopped and `requiresUnlock` on iOS are unchecked. Text replies are not passed on. A web page shows no notifications. The Android intent module (`plugins/android-intents/android`) has not been compiled, and no intent has been received or started on a device: the intent filter config plugin (`packages/mobile/intent-filters.plugin.cjs`) has not run in a prebuild, and an `am start` with a declared action is unchecked. A sender's extras of a type the app cannot unpack drop all extras of that intent. No launcher has shown a shortcut: the macOS dock menu and the Windows jump list (`apps/desktop/src/os-shell.ts`) have no native run, the Android shortcuts config plugin (`packages/mobile/shortcuts.plugin.cjs`) has not run in a prebuild, and no installed web app has offered its manifest shortcut. Linux has no desktop actions, because the `dir` target writes no desktop file, and iOS has no quick actions.

### Layers and scaffold

**Opt-in run.** `bun run test:scaffold:full`, 17 October 2026: `scaffold new` generates an application that installs with a frozen lockfile; after `add collection`, `add capability` and `add target` it passes format, generation, typecheck, build, its unit tests and a Playwright spec that creates, opens and edits a record through the default screens.

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

# Implementation status

No public release has been made. The entries use these kinds of evidence:

- **Browser:** Playwright in Chromium against the real host (`bun run test:e2e`).
- **Native:** a packaged build or a real OS facility, on a named platform.
- **Live:** real providers, devices or [systems of record](glossary.md#system-of-record), with explicitly configured accounts.
- **By hand:** a one-off run of a script or tool, with what it showed.

## By area

### Catalog, runtime and storage

**Measured.** On an M-series laptop, 20 one-record commits on 20,000 records of about 5 MB in total. Row storage took 26–30 ms per commit, and one document took 46–52 ms.

**Live.** A [triggered](glossary.md#trigger) agent has requested approval on a real local model, and a person approved ([agents and providers](#agents-and-providers)).

**Not shown.** No host route starts an [agent run](glossary.md#agent-run) from an [agent definition](glossary.md#agent-definition). The line-station approval request tile and the frame's approval request review have no browser test.

**Limits.**

- Row storage still serializes every row to find the change, so commit CPU grows with state.
- Receipts are kept by default.
- The phone's snapshot storage has neither rows nor retention.
- No encryption at rest.

### Hosted instance

**By hand.** On 18 October 2026, on macOS arm64, against a throwaway Postgres 17.6 container. The container used the `supabase/postgres` image, with a password set for the run.

- With `STORAGE_POSTGRES_URL` set, the storage conformance cases and the lease cases passed through `Bun.SQL`. Two pools raced for one [workspace lease](glossary.md#workspace-lease), and one won.
- Two project-tasks instances ran `serve --hosted-workspace live-f1`, each with its own local directory. The second was refused with `CONFLICT`, and `project.create` committed through the first.
- The first was paused with SIGSTOP for 33 seconds. A new instance then took the lease with [fencing token](glossary.md#fencing-token) 2 and listed the project.
- The first was resumed. It logged `lease-lost` and exited.

**By hand.** On 27 October 2026, on macOS arm64, `patterns/lab-requests-hosted` ran with `bun run dev:web` against a throwaway Homebrew Postgres 17.11 server on loopback, without Docker.

- The stand-in identity provider ran on `https://127.0.0.1:4372` with a certificate from a throwaway openssl CA, which the policy's `workforce-idp` binding trusted.
- Sign-ins were driven with curl, not a browser, because no browser on the machine trusted that CA. A technician submitted a request recorded under their email. A viewer listed it and was refused a submission.
- A second instance started with `serve --hosted-workspace` exited with code 5 and `CONFLICT`. After the launch stopped, which set the lease's expiry to the time of release, the same command took the lease at once with fencing token 2 and listed the request.

**Not shown.**

- No [hosted instance](glossary.md#hosted-instance) has run behind a public TLS listener with workforce OIDC sign-in. `lab-requests-hosted` signs in on a loopback listener against the stand-in provider, and no browser has completed its sign-in.
- None has run under a real orchestrator, or on Linux.
- No commit from a paused holder has been caught by the fence in a live run. The resumed instance's renewal found the loss first, and the tests cover the fence.

**Limits.**

- One process serves one workspace. Many workspaces need one instance each behind a router.
- Blobs, agent run history, the audit log and the plugins' local files stay in the instance's local directory. A takeover on another machine starts without them unless that directory is on shared storage.
- The embedded CLI verbs (`sync`, `drain`, `backup`, `restore`, `migrate`, `--embedded`) open a local workspace only. Back up the database with its own tools.
- No Cloudflare Durable Object host exists. The host uses Bun APIs, and no Workers entry is written.

### Fleet agent

**Browser.** On 18 October 2026, `examples/fleet/e2e/fleet.pw.ts` passed in headless Chromium against the real host. It covered enrollment from the Devices screen, a site report, a channel created and assigned from the screens, and the drift shown on the Health screen.

**By hand, browser.** On 27 October 2026, on macOS arm64, `patterns/lab-requests-site` on port 4359 and `examples/fleet` on port 4340 ran side by side with `bun run dev:web` in Chrome. The site enrolled with a code from the Devices screen, reported, and forwarded its audit log, which the fleet's Audit screen listed. `publish-release.ts` published a signed bundle of 46 files, with a 92 MB binary, to `lab-stable`. After the site was put on that channel, the release was staged in `fleet-releases`, and `fleet.health` reported no issues once the next report named it.

**Not shown.**

- No site has reported to a [fleet](glossary.md#fleet) across a real network, behind a firewall that allows only outbound https.
- No staged release has been activated by `site install` from the `fleet-releases` folder on a real machine with a loaded system service. The fleet-agent test and the 27 October run ([site install](#site-install)) do it on a staged prefix without `--apply`.

**Limits.**

- The relay polls the fleet, every two seconds by default, and forwards one request at a time with bodies up to 1 MiB. It carries no event streams.
- A site credential is not rotated. A fleet that loses one re-enrolls the site with a new code.
- Staging fetches each release file whole. There is no resumed download.
- The fleet's Devices screen calls a `field-sync` enrollment a phone, as device-link names it. A site is enrolled with that kind.
- A failed cycle is kept only in the agent's in-process `lastError`. It is neither logged nor reported, so a site that cannot stage a release shows at the fleet as drift with no reason.
- Staged release files keep mode 0644, so the staged binary cannot run `site install` itself.
- The fleet example's screens show times as raw milliseconds.

### Telemetry

**Not shown.**

- No export has reached a real OpenTelemetry Collector or backend. The tests check the OTLP/HTTP JSON against the OTLP specification with a loopback fixture collector.

**Limits.**

- Each export rereads the audit log's segment files to find new events, so exports slow down as the log grows.
- Counters restart when the host restarts, and history from before the start is not exported.
- There are metrics and traces only, no logs.

### Site bundles

**By hand.** `bun run bundle create` built a 69 MB project-tasks [site bundle](glossary.md#site-bundle) of 46 files on macOS arm64. `verify` accepted it, and `admit` refused it until approved.

**By hand, 17 October 2026.** A rerun after the bundle began writing its contract, security manifest and SBOM from the catalog. The signature verified, and `admit` listed the requirements to approve.

**By hand, 27 October 2026.** `bun run bundle create` built a `patterns/lab-requests-site` bundle of 46 files, with a 92 MB binary, on macOS arm64. The binary carried no `.exe` suffix after `scripts/bundle.ts` stopped matching `darwin` as Windows. `admit` on the copy the fleet agent staged refused it until approved.

**By hand, 27 October 2026.** `bun run bundle create` signed the [best-before date](glossary.md#best-before-date) 2027-04-25 into a project-tasks bundle (the example since renamed `field-service`) with a shelf life of 180 days, and `verify` printed it.

**Not shown.**

- `site install` consumes a bundle ([site install](#site-install)), but nothing verifies one again at launch.
- Bundles are directories rather than archives.
- Approvals are unsigned site data.
- No cross-platform build has been verified on its target.

### Site install

**Added, not yet run.** The `site-install` CI job on Ubuntu runs `plugins/site/test/install.test.ts`. It applies `systemd-analyze verify` to the unit and `nft -c -f` to the rules.

**By hand.** On 27 October 2026, on macOS arm64, `site install` installed release 1.2.0 of `patterns/lab-requests-site` from the folder the fleet agent staged it in. It ran with `--prefix`, `--service systemd`, `patterns/lab-requests-site/site-policy.json` and a site approval, without `--apply`. It rendered the unit and `egress.nft` and set mode 0755 on the installed binary, and `site status` verified the current release. Neither file was loaded, because the machine is not Linux.

**By hand, 27 October 2026.** On macOS arm64, `site install` placed that project-tasks bundle in a staged prefix with `--service none` and an approval of its requirements. `site status` reported the release verified, with its best-before date. `site uninstall --purge --trust` ran the installed release's `drain` and then removed the release, configuration and data directories.

**Not shown.**

- No `--apply` run has loaded a service or firewall on a real host, on Linux or Windows.
- The Windows path (WinSW XML, Windows Firewall script) has only been rendered, never run.
- No kiosk client mode exists.
- No purge has run against a service with undelivered effects on a real host.

### Application lifecycle

**By hand, 27 October 2026.** A project-tasks CLI compiled with a build time of 1 January 2026 served with a best-before date of 30 June 2026. In headless Chromium the web frame showed the date in the status box and the notice that the date has passed. `project create` committed, and `compliance report` on the instance's audit log reported the `best-before` check as `warn` and exited 0.

**Not shown.**

- No Playwright spec covers the frame's best-before notice.
- No fleet has received a best-before date from a site across a real network.

**Limits.** `network export` on its own names the application ID as the socket owner, while `site install` runs the service as `agent-native`. An export made apart from the install needs `--user`.

### Workforce sign-in

**Shown, deterministic.**

- `plugins/site/test/workforce.test.ts` signs in against a fake provider. It covers PKCE, a one-use state, session expiry and the ID-token checks: audience, nonce, verified email and the discovered issuer.
- `packages/adapters/src/http-credentials.test.ts` shows a cookie accepted only as a cookie and a bearer only as a bearer.
- The field-service hardening test starts an `external` policy with a bound provider and no owner session.
- `plugins/site/test/identity-provider.test.ts` signs in against the stand-in provider in process, and `patterns/lab-requests-hosted/test/hosted.test.ts` signs in through the network guard over HTTPS with a throwaway CA.

**Not shown.**

- No real identity provider has been signed in to.
- Endpoints on another origin than the issuer, such as Google's, are refused.
- Sessions live in memory, so a restart signs everyone out.

### Station sign-in

**Shown, deterministic.** `workstations/sign-in/test/sign-in.test.ts` runs a station over HTTP and shows that:

- an operator signs in with badge and PIN and acts as that operator;
- the lockout holds even against the right PIN;
- a session expires;
- a second sign-in at the [seat](glossary.md#seat) ends the first session;
- revoking a badge ends its sessions;
- neither the badge value nor the PIN reaches the workspace database.

**By hand, browser.** On 27 October 2026, `patterns/lab-requests-sign-in` ran with `bun run dev:web` in Chrome on macOS, with badges typed as keyboard-wedge bursts. Badges enrolled on the badge screen showed live. At the seat, a specimen label was refused as not a badge. A technician signed in with a PIN starting with zero, scanned a specimen label into the bench screen and submitted a request that recorded the technician as requester. A wrong PIN for the viewer's badge got "Badge or PIN not recognized". After the viewer signed in, the technician's session was gone and the viewer's submission was refused. Leaving the seat screen ended the viewer's session at the host, and so did two idle minutes in a second run.

**Not shown.**

- No physical badge reader has been tested.
- Signing in does not move a seat that an agent holds.
- A page reload loses the operator token, and its session stays open until it expires.

### State migrations

**Not shown.**

- Removing a feature or plugin from an application drops its slice at the next commit. Nothing keeps or exports the dropped data.
- crm-capture, fleet and quality-inspection keep their unversioned `upgradeState`. The other examples and `patterns/lab-requests-operations` declare [state migrations](glossary.md#state-migration).
- A target port that maps effects by `contractVersion` has not been written.
- The phone's storage stamps versions, but has no staged `migrate`.

### Workflows

**Not shown.** No browser test opens the workflows screen, and no instance has run for days on a live host.

**Limits.**

- Steps run in order; there are no branches or parallel steps.
- Only a serving host runs instances, and they make no progress while it is stopped.
- A step's command commits whole, with no savepoint inside it.
- A changed definition stalls its running instances; nothing migrates them.

### Authorization and live queries

**Open.** A session revoked during a request does not stop it ([known defects](#known-defects)).

### Surfaces

**Shown, browser.**

- **field-service:** live updates from an external MCP process, drafts that keep their base revision, and paging past the first page.
- **quality-inspection:** keyboard-only capture, and a draft that keeps its sample when another caller records it first.
- **crm-capture:** search, adopt and log.
- **lab-requests-review:** on 27 October 2026, `bun run dev:web` in Chrome on macOS. As the local owner, an approval of the request `dev.ts` submitted as a second technician showed live. After a method change it was marked as on an earlier revision, and the owner signed the new revision. A second signature of that revision and a signature of the owner's own request were refused with their messages.
- **lab-requests-signals:** on 27 October 2026, `bun run dev:web` in Chrome on macOS, against the plant stand-in that `dev.ts` starts. A test request placed in chamber 2 showed the chamber's temperature from OPC UA and humidity from Sparkplug B, updating live. When the humidity drifted to 64.7 % RH, the chambers screen marked chamber 2 out of tolerance while chamber 1 stayed conditioned. The audit log recorded the egress to both destinations.

### Agents and providers

**Not shown, live.** No live ChatGPT consent, token refresh or revocation, and no Claude or AI SDK inference. No provider credentials were discovered or reused.

**Local models, live.** On 18 October 2026, on an Apple M3 laptop with macOS 26.7.1. The server was llama.cpp `llama-server` 0.7.0, Homebrew build 11669. The model was Gemma 4 E4B-it Q4_0 from `ggml-org/gemma-4-E4B-it-GGUF`: Apache-2.0, 4,590,807,392 bytes, measured `sha256:a555b900214b477d8880e7832e0b8925e139b0159640036b09fe472b6f2097f2`.

`plugins/model-server/test/live.test.ts` passed 5 times in 5. The plugin started the real server through the [process port](glossary.md#process-port), measured the weights and served the `note.suggester` agent. Given the task "Request approval for adding a note with id n1 that says "Call the supplier"", the model requested approval for `note.add` with that input. The run recorded the [model entry](glossary.md#model-entry), the measured digest and `verified: true`. Each run took 22–31 seconds, including the server start.

`plugins/automation/test/live.test.ts` passed 3 times in 3. A received lot started the `lot.reviewer` run through its trigger and [standing grant](glossary.md#standing-grant). The model read the lot, then requested approval for `lot.inspect` on `l1`. A viewer's approval was refused, and an inspector's approval committed the inspection. Each run took 41–68 seconds.

The runs found these defects, now fixed and covered by deterministic tests:

- A tool envelope nested a recursive input schema's `$defs`, so llama.cpp refused the tool (`cannot resolve $ref`). `toolEnvelopeSchema` moves them to the root.
- A requesting agent's model was never told which commands it may request approval for or their inputs. A trigger run's prompt left out the agent's instructions. Both now start with `agentInstructions`.
- An application refusal or a malformed call ended an AI SDK run. The model now reads the error and may correct the call.
- `expectedRevisions` was offered on queries and `approval.request`, where it means nothing, and models filled it with invented keys.
- The egress guard's 30-second request timeout cut off a model that reasons before it answers. A destination binding now takes `timeoutMs`.

On 27 October 2026, `patterns/lab-requests-local-model/test/live.test.ts` passed once, in 75 seconds, on the same machine, server and weights. A submitted test request started the method suggester through its trigger on the measured `lab-methods` entry. For the description "Tensile strength of the weld coupon", the model requested approval for `test-request.update` with the method `ASTM E8`. The request's input repeated the unchanged specimen and description. Its `baseRevisions` key was the bare ID wrapped in Gemma's `<|"|>` string tokens, not `test-request:<id>`. `approval.request` accepted that key, and the live run did not decide the request. Closing the host during the run's last model turn logged an `ECONNRESET` from the cancelled call.

Qwen2.5-1.5B-Instruct Q4_K_M failed the note scenario in every run before these fixes, and was not rerun after them. No vLLM and no fine-tune has run. Weights are not yet delivered as bundle artifacts.

**Agent scenarios, live.** Gemma 4 E4B-it Q4_0 on llama-server 0.7.0 passed the model server's `requests approval for a note on a real model`, described above. The [agent scenarios](glossary.md#agent-scenario) in `packages/testing` and `examples/receiving` have passed with the deterministic harness only.

**By hand, browser.** On 27 October 2026, `patterns/lab-requests-agents` ran with `bun run dev:web` in Chrome on macOS. After the trigger was enabled on the Automation screen, a request submitted without a method got the job's approval request for "ASTM E8 tensile test". On the same request, **Suggest a method (offline run)** started a deterministic run from the screen's UI session. The run requested approval for `test-request.update` and called `ui.request-review`, and the screen showed the review above both pending suggestions. Acknowledging closed it, and approving the run's suggestion set the method on the open screen. Approving the job's suggestion afterwards showed that the record had changed and left it pending, and rejecting it closed it. `packages/frame/src/lib/ui-intents.test.ts` shows that an open intent reaches the open handler, and no test covers the default handler's navigation through `screens.resources`.

On 27 October 2026, `patterns/lab-requests-local-model` ran with `bun run dev:web` in Chrome on macOS, on the llama-server stand-in that `dev.ts` starts. After the trigger was enabled on the automation screen, a test request submitted without a method showed the suggested method "ASTM E8 tensile test" on its screen. Approving it set the method.

### Execution host

**Native.** On 17 October 2026, `bun run test:execution-host:linux` ran on Docker Desktop 29.4.0 (Linux 6.12.76-linuxkit, arm64). `IMAGE` named an image assembled by hand from a locally cached Alpine 3.23 base, with bubblewrap 0.12.0 and Bun 1.4.0 for musl. All 18 tests passed, including the eight in `test/sandbox.test.ts` under real bubblewrap and the plugin's seccomp filter. `test/linux/Dockerfile` itself was not built, because Docker Desktop's image pulls hung behind its proxy.

**By hand, browser.** On 27 October 2026, `patterns/lab-requests-sandbox` ran with `bun run dev:web` in Chrome on macOS. The request screen showed the execution host's reason that darwin has no backend, with **Analyze in the sandbox** disabled. Readings recorded on the screen listed live, and statistics entered by hand showed as entered by hand.

**Not shown.**

- **Platforms:** no run on x86-64, on glibc, or on a host kernel outside a container. No macOS or Windows backend exists.
- **Agents:** no coding agent harness (Codex, Claude Code) has run inside a sandbox. The tasks were the probe script, the application CLI and an MCP client.
- **Pattern:** `patterns/lab-requests-sandbox/test/sandbox.test.ts` has not run under bubblewrap. On macOS it skips, and the pattern's other tests show the unavailable path.
- **Egress:** the proxy path was shown to a loopback listener, not to a real provider over TLS.
- **Distributions:** those that restrict unprivileged user namespaces, by Ubuntu's AppArmor rule or a disabled sysctl, were not tried.

### Systems of record

**Not shown.**

- Delivery, sync and [remote queries](primitives.md#remote-query) run only against fakes: in memory in quality-inspection, crm-capture and asset-survey, and the loopback HTTP LIMS of `patterns/lab-requests-system-of-record`. Asset-survey's fakes are the demo EAM and an extractor that reads text embedded in generated nameplate images.
- Remote queries and [data providers](primitives.md#data-provider) are used by crm-capture and asset-survey.
- There is no real system of record, CRM or EAM.
- No extraction has run against a model provider. Asset-survey's model extractor has run only against a mock model and a fake network port.
- Asset-survey's live comparison over the six sample plates (`examples/asset-survey/test/live-extraction.test.ts`) has not run.
- The asset-survey export directory is written by a real child process in its test, not by a deployed site.
- Two dispatcher processes cannot share a local workspace, because the OS lock refuses the second (`packages/adapters/src/ownership.test.ts`). Dispatchers race only within one process, which the reliability tests cover, or across hosted instances under the fenced lease.
- Capture timings come from synthetic runs.

**By hand, browser.** On 27 October 2026, `patterns/lab-requests-system-of-record` ran with `bun run dev:web` in Chrome on macOS, with its fake LIMS on 127.0.0.1:4371 and the destination bound by `site-policy.dev.json`. **Register in LIMS** on a request with a method was accepted as `LIMS-1`. While the LIMS reviewed, a request submitted through the CLI stayed pending with **Register again** disabled. After the LIMS forgot it, the dispatcher held the effect after six attempts, and the request screen showed it live. Resolving it as applied with the reference `LIMS-2` accepted the publication with that reference. A request without a method was rejected with the LIMS's reason, and a request registered at another site arrived through the feed as submitted by `lims-integration`.

### Peer applications

**Not shown.**

- **Live:** receiving and quality-inspection have connected only in the two-host tests on loopback. Nobody has connected them through `bun run dev` and the Peers screens. Only the two assignment patterns have connected that way ([assignments](#assignments)), and no pair has run across two machines.
- **Browser:** no browser test opens the Peers screen.
- **Mobile:** the field application's drift check has run only under Bun, not in a Hermes build.

**Limits.**

- No mTLS client certificate binds a peer at the transport, and a peer's key cannot be rotated.
- The `jti` cache is in memory ([security and compliance](security-and-compliance.md#peer-applications)).
- The Peers screen does not show drift status. Only an effect's pending message and an unavailable read report a drifted operation.
- An assertion says `act: agent` only when the effect or the read carries a run ID.
- A peer target with no connection makes `integrations.sync()` and the CLI `sync` fail at that target, after the targets before it have synced.
- Receiving's lot search returns the first 50 lots. Arrivals carry no plant, so everyone who captures at some plant sees all of them.
- `asset-survey` and `asset-survey-field` keep the device link: a phone has no egress guard, and Ed25519 signing on Hermes is unproven.

### Assignments

**Not shown.**

- **Browser:** no pattern runs the person, agent or peer lane. The notes applications that ran them by hand and in Playwright on 27 October 2026 were left out when the content moved to lab requests, and have not been rebuilt there. The asset survey's screens have not run assignments in a browser.
- **Agent:** an agent assignee has run only with the deterministic harness (`packages/assignments/test/lanes.test.ts`). No model has read a brief and reported.
- **Target:** the target lane has run only in tests, against a function port.
- **Screens:** an application that fills no slots still shows the brief as JSON and takes the scope and a report's subject as typed record keys.

### Connector plugins

**By hand.** On 17 October 2026, on macOS, against independent implementations started from the uv cache.

`connector-opcua`'s client ran against an asyncua 2.1.0 server on loopback, in an anonymous session with security policy None. It read a Double, a String, an Int32, a UInt64 above 2^53 and the server's current time (`i=2258`). It reported an array as unsupported and an unknown node as a bad status. It then closed the session and channel.

`connector-mqtt`'s observer ran against an amqtt 0.12.1 broker. A paho-mqtt 2.1.0 publisher encoded Sparkplug B with protobuf 7.36.2 from the Eclipse Tahu schema. A node birth, then data by alias, became the readings `temp` 72.25 and `count` -7, both `observed`.

**Shown, browser.** `examples/receiving/e2e/receiving.pw.ts` on macOS, against the real host with a deployment policy binding the three ERP exchange folders to temporary directories:

- the notice is imported from the inbox;
- a line is counted, classified and posted, and the goods receipt file appears in the drop folder;
- the test answers as the ERP with a receipt file, and the ERP screen shows it accepted.

A second spec ran the same day and leaves the receipt unreadable. The Held receipts screen shows the held goods receipt with the reason. Recording it as applied empties the list and counts it accepted on the ERP screen.

**Not shown.**

- **Equipment:** no real PLC, OPC UA gateway, Sparkplug edge node or plant broker, and no broker over TLS or with credentials.
- **OPC UA security:** signed and encrypted channels and user sign-in are not implemented, so a server that requires them is refused.
- **Files:** no real network share, SMB or NFS mount, or other system writing receipts. The exchange has run only against temporary directories and the fake consumer.
- **HTTP:** no real REST system of record, only the loopback fake.

### Operator workstation bridge

**Shown, browser.** In `line-station`, against the real host and a separate fake HMI process:

- a stop is classified;
- an order is scanned and started with a hold;
- the recipe is loaded and read back;
- takeover blocks the bridge.

The kit's interaction tests also pass.

**By hand.** On 8 October 2026, `bun run station:golden` identified 5 of 5 screens with no confident misread. It ran against recorded expectations rather than a model, which checks the wiring only.

**Not shown.**

- **Hardware:** no physical scanner has been checked, and the desktop shell does not grant Web Serial or WebHID.
- **Models:** no local OCR or vision model has been called.
- **Computer use:** there is no live computer-use driver, and no VNC, RDP or UI Automation transport.
- **Safety:** nothing here is safety-rated or validated.

### Hardware drivers

**Shown, browser.** `examples/quality-inspection/e2e/instrument.pw.ts` on macOS, against the real host with a deployment policy binding the Python instrument [driver](glossary.md#driver). The driver reads a simulated instrument over a pseudo-terminal pair, and the inspector uses the reading as a result. The spec is skipped where uv or a cached pyserial is missing.

**Not shown.**

- **Equipment:** no physical instrument, controller or workstation application has been connected. The instrument driver has run only against its pseudo-terminal simulator, and the station automation driver only against its simulated station.
- **Windows:** the .NET SDK's STA handler thread, COM interop and a `win-x86` build have not run. The line-station `ComStation` has never run, and its member names are an assumed object model rather than a real vendor's.
- **Linux:** the Python and .NET driver tests have run only on macOS.
- **Served automation route:** line-station's automation route has run only in tests that start the driver directly. A served host starting it through the process plugin from a site binding (`STATION_ROUTE=automation`) has not run.
- **Not built:** a remote transport for a driver on another machine, live non-journaled readings, remote queries over driver state, Android native-module drivers and a C++ SDK.

### Security and compliance

**Shown, browser.** The Compliance screen shows a new denial without a reload.

**Not shown.**

- **Rules:** the exported rules are compared as text only. The rules were never loaded into nftables, Windows Firewall, systemd or a cluster.
- **Live traffic:** no off-host syslog collector, and no live provider traffic through the [egress guard](glossary.md#egress-guard).
- **Zero trust:** it starts only with a workforce provider bound, and no real provider has been signed in to ([workforce sign-in](#workforce-sign-in)).
- **Processes:** the agent harness launches still spawn directly instead of through the process port. Tree termination has not run on Windows.
- **Secrets:** the Bun platform has no secret store, so processes that declare secrets are unavailable there.

Control mappings are indicative.

### Desktop

**Shown, native, outdated.** An earlier source state was staged and packaged unsigned on macOS arm64, before the system-of-record, screen and CLI changes. It passed the offline smoke test and the Electron owned and attached lifecycle tests. Rebuild and rerun them before relying on a packaged build ([desktop](desktop.md#build-and-smoke-test)).

**Not shown.**

- the current packaged build;
- Windows x64, Linux x64 and macOS x64, which are configured in CI but have not run;
- credential-vault set, get and delete on any platform;
- signing, notarization, installers and updates.

### Mobile

**By hand.** `expo prebuild --platform android` ran once on the fixture, with managed-config composed temporarily. It wrote `res/xml/app_restrictions.xml` and the `APP_RESTRICTIONS` meta-data. `expo-modules-autolinking resolve` found both plugins' Kotlin modules. Autolinking also found an Expo module in a plugin of this repository through the root `node_modules`, checked against a temporary probe module.

**By hand, 17 October 2026.** The asset-survey field application was prepared with `AGENT_NATIVE_MOBILE_APPLICATION=@agent-native/asset-survey-field bun run mobile:prepare`. `expo export --platform android` then bundled it. Metro resolved its native screens, `expo-camera`, `expo-file-system` and the hub-link, managed-config and intent-scanner entries. `expo config --type introspect` on the same entry showed the `expo-camera` config plugin applied from the manifest's `expoPlugins`. It set the iOS camera usage description, no microphone description, and only Android's `CAMERA` permission.

**By hand, 27 October 2026.** The field application with the OS, share-target, notifications and Android intents plugins was prepared the same way, and `expo export --platform android` bundled it. `expo config --type introspect` showed the `expo-notifications` config plugin and an intent filter for `dev.agentnative.survey.action.FIND_TAG` with `android.intent.category.DEFAULT`.

**Shown, browser.**

- The web frame on a tablet-sized viewport (`tests/e2e/compact-shell.pw.ts`, Chromium with touch). The sidebar becomes a bar with a menu sheet that closes on navigation, the capability palette opens, and the sidebar returns at desktop width.
- The asset-survey [hub](glossary.md#hub) (`examples/asset-survey/e2e/survey.pw.ts`). The full flow runs from structure through review to filing, with a device paired over HTTP, and the compact review queue shows at 768×1024.

**Not shown.**

- **Pairing:** pairing has not run on a device, and the native pairing screen has not rendered. The device credential has not been stored in a real Keychain or Keystore. There is no QR pairing.
- **Hub screens:** the screens have not been opened in a WebView on a device. The WebView settings are unverified: navigation refusal, no new windows, private cookie store and camera prompt.
- **Mobile platform:** it has not run on a device. The Expo SQLite driver, file blob store, lock and background task are untested, and the globals check has not run under Hermes.
- **Native UI:** the native frame and components have not rendered.
- **Native modules:** the plugins' Kotlin and Swift modules have not been compiled. No Android or iOS build has been produced, and nothing has run on an emulator, simulator or device.
- **Field application:** its screens have not rendered, including the worklist screens and the survey brief rebuilt on the [worklist](glossary.md#worklist) kit. Taking photos, finding a node from a scan, and pairing from managed configuration have run only as the Bun pipeline test without the native plugins. The asset tag intent, the work request, the share and the assignment notice have run only with faked device bindings. A phone at the version before the worklist has not been upgraded in place: the migration test shows the pairing kept and a workspace with pending records refused.
- **Planned checks:** Test DPC restrictions, `simctl` managed configuration and `adb` scan broadcasts, to run on demand.

### OS integration

**Shown, browser.** `examples/field-service/e2e/os.pw.ts`:

- The served web manifest carries the protocol and file handlers.
- A `?os=` landing with a task link opens that task's work order, shows where it came from and clears the address.
- A submitted Markdown file shows the prefilled task with its provenance, and adding it creates the task.
- An uploaded image shows its attachment in the prefill. The added task links to bytes the page can download.
- A share target form is posted cross-site from a blank page, first with a link and then with a PNG. Each lands on the application, shows the prefilled task with its provenance, and the added task is created.
- A reminder asked for in the page shows as waiting for the desktop or phone application.
- The web manifest lists the New task shortcut. Its landing shows an empty prefilled task opened from a shortcut.
- Open map opens the OpenStreetMap search for the site in a new browsing context without an opener. The test answers that URL locally. Send summary passes the work order's title and summary text to `navigator.share`, which the test replaces with a recorder.

**Not shown.** Nothing has been registered with, received from or performed through a real OS.

- **Desktop wiring:** the Electron wiring (`apps/desktop/src/os-shell.ts`) has no native run. A macOS link or file reaches it only from a packaged bundle.
- **Installed web application:** no installed web application has registered the protocol or file handlers, and the launch queue path has not run in a browser. Whether a Chromium version accepts the SVG icon for installation is not checked.
- **OS actions:** the browser has run `runOsAction` only with a replaced `navigator.share`, and the desktop shell has relayed no open or share from it. On a device, the field application's screens call `useOsAction`, and they have not rendered.
- **Expo bindings:** `packages/mobile/src/expo/os-shell.ts` has not run on a device or simulator. No Android intent filter, iOS associated domain or document type has been registered, and no exported association file has been served from a real domain.
- **Share:** no share has come from a real share sheet. The Chromium test posts the share target form itself.
- **Expo sharing:** `expo-sharing`, whose receiving API is experimental, has not run on a device. Its Android SEND filter and iOS share extension are unbuilt.
- **Share details:** the macOS share menu has not opened. On Android a `content:` name is often opaque, so such a file matches only by its media type.
- **Staging:** staged uploads are lost on restart.
- **Electron notifications:** no notification has been shown by a real OS, and the Electron `Notification` path has no native run. Its action buttons appear only on macOS and Windows, and whether macOS shows them for an unsigned build is unchecked.
- **Expo notifications:** `expo-notifications` has not run on a device. The permission prompt, the categories, a reply after the application was stopped and `requiresUnlock` on iOS are unchecked.
- **Notification limits:** text replies are not passed on. A web page shows no notifications.
- **Android intents:** the intent module (`plugins/android-intents/android`) has not been compiled, and no intent has been received or started on a device. The intent filter config plugin (`packages/mobile/intent-filters.plugin.cjs`) has run only in `expo config --type introspect`, not in a prebuild, and an `am start` with a declared action is unchecked.
- **Intent extras:** a sender's extras of a type the application cannot unpack drop all extras of that intent.
- **Shortcuts:** no launcher has shown a shortcut. The macOS dock menu and the Windows jump list (`apps/desktop/src/os-shell.ts`) have no native run.
- **Shortcut builds:** the Android shortcuts config plugin (`packages/mobile/shortcuts.plugin.cjs`) has not run in a prebuild, and no installed web application has offered its manifest shortcut.
- **Desktop actions:** Linux has none, because the `dir` target writes no desktop file. iOS has no quick actions.

### Layers and scaffold

**Opt-in run.** On 17 October 2026, `bun run test:scaffold:full`. `scaffold new` generates an application that installs with a frozen lockfile. After `add collection`, `add capability` and `add target`, it passes format, generation, typecheck, build and its unit tests. It also passes a Playwright spec that creates, opens and edits a record through the default screens.

**Opt-in run, complete export.** On 17 October 2026, `bun run test:scaffold:full`. The complete source export installs frozen and passes format, typecheck, generation, build and its 810 tests. The driver SDKs, .NET projects and certificate fixture are now exported. An authored capability with its policy rule answers over the exported HTTP host.

**Opt-in run, installed framework.** On 17 October 2026, `bun run test:scaffold:full`. The framework packs into 39 tarballs served by the loopback registry, and `scaffold new --registry` exports without framework source. The export installs, and reinstalls with `--frozen-lockfile` from a clean `node_modules`. It adds a target with the installed [scaffold](glossary.md#scaffold) and passes its whole `bun run check` and its Playwright spec.

**Opt-in run.** On 27 October 2026, `bun run test:scaffold:full` passed its 16 tests with `field-service` as the configured application. The complete source export wrote the local-model pattern's stand-in weights at run time. The framework packed into 49 tarballs for the registry install.

**By hand, mobile export.** On 17 October 2026, `bun run scaffold <dir> --name field-survey --example asset-survey-field` exported `apps/mobile`, the field application and the hub example it imports. In the export, these passed:

- a frozen install;
- `bun run typecheck`;
- `bun test examples`;
- `bun run mobile:prepare`, whose native config lists the managed-config and `expo-camera` config plugins;
- `expo export --platform android`, which wrote a Hermes bundle.

`test:scaffold:full` does not repeat the mobile steps, and no native build was made from the export.

**By hand, features.** On 22 October 2026, in a `scaffold new` export, `add collection`, `add capability`, `add target`, `add agent` and `add feature stock --screens` produced an application that passed typecheck, build, its 17 unit tests and its Playwright spec. `bun run generate` was skipped ([known defects](#known-defects)).

**By hand, assignment kinds.** On 27 October 2026, in a `scaffold new` export with collection `note`, `add agent closer --collection note`, `add assignment-kind inspection --collection note`, `add collection site --tree` and `add assignment-kind site-check --collection site` produced an application that installed frozen and passed format, typecheck and its 13 unit tests. `bun run generate` wrote the reference with the `assignment.*` operations of both kinds. No build or Playwright spec ran on that export.

**Limits.**

- An application cannot compose the `device-link` plugin and the `device` feature: both claim the `device` resource type.
- The `device-link`, `hub-link`, `notifications` and `sign-in` plugins keep operation namespaces that differ from their IDs (`link`, `hub`, `notification`, `station`).
- An application authorization port built without `definePolicy` declares no `covers`, so composition cannot refuse one that also decides a feature's operations.
- No framework version has been published to npm or any real registry. Every install from versions ran against the loopback registry (`release:serve`).
- The packages are MIT licensed.
- The packages publish TypeScript source, and only Bun and Vite have consumed them.
- An example export still copies the framework.
- An instance hosts one application.

## Known defects

A session revoked during a request does not stop the request. HTTP authenticates each request once. If a session is revoked or expires while its command waits, the command's context stays live and the command commits. New requests with that token are refused.

A pattern or example started with `bun run dev` or `dev:web` titles its browser page and window with the display name in `app.config.json`, such as "Field Service", because `AGENT_NATIVE_APPLICATION` overrides only the application. The header shows the application's own label.

These were fixed by inspection only and have no regression test:

- matching Windows paths during staging;
- keeping a scanner connected when it uses default routes;
- keeping scanner setup's unsaved edits when another device saves.

## Planned improvements

- Give each session an abort signal that fires on revocation and expiry, and combine it with the request's signal. This fixes the known defect.
- Share event, receipt and cancellation adaptation between the HTTP and direct surface adapters. The known defect is one place where the adapters still diverge.
- Extract a reusable draft model from capture and scanner setup: target, base revision, local values and conflict state.
- Consolidate the repeated polling, delay-cancellation and credential-refresh lifecycles once their semantics settle.
- Before a 1.0 version, replace the `./*` wildcard exports with explicit entrypoints. Today every source file of a package is a public entrypoint.

## Out of scope

- managed cloud hosting: the hosted platform runs on any server with Postgres, and no provider is targeted;
- multi-device synchronization;
- more than one application per instance;
- package publication;
- signed distribution.

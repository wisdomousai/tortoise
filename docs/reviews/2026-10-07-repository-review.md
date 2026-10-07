# Repository review: 7 October 2026

UI, MCP, CLI and HTTP adapters call the same runtime. Local commands can save feature state, a receipt, journal entries and outbox effects in one transaction. The tests cover many of those paths. Focused probes found failures in inspection draft identity, authorization during asynchronous work, station actions and delivery status.

The review did not change application behavior. Each finding says whether a probe reproduced the defect or source inspection established it. **High** means the affected guarantee needs repair before it can be relied on; **medium** marks a defect in a supported use; **low** marks a bounded edge case or maintenance issue. These priorities do not score exploitability.

**Scope and source state.** Four review tracks covered contracts/runtime/adapters; client/React/UI and the project/inspection domains; integrations/stations/devices/agents; and service/desktop/scaffolding/build/documentation. The checkout started at `8f9e524` with an existing station-profile import edit, which another session committed as `83ef868` during review. That session also added example launch scripts and the P11/ADR 005 architecture decision. Those edits were preserved. This is therefore an explicitly described working-tree review, not certification of an immutable release. Tests below ran before the later documentation and example-launch edits; affected production files were checked again when recording findings.

**Verification performed**

| Gate                                 | Observed result                                                                                                                                    | What it establishes                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `bun run check`                      | Passed: 229 tests, 1 deliberate skip, 1,086 assertions; formatting, types, boundaries, generated artifacts, registries and production build passed | Current source checks and existing deterministic scenarios                              |
| `bun run test:e2e`                   | 7 passed; 2 packaged Electron tests skipped                                                                                                        | Chromium flows for workspace, inspection and station; no current packaged-native result |
| `bun run test:scaffold:full`         | 3 passed, 20 assertions                                                                                                                            | Fresh export, pinned installation, independent checks and a capability extension        |
| `bun run station:golden`             | 5/5 screens, no confident misread                                                                                                                  | Recorded-expectation wiring; no live OCR/vision accuracy result                         |
| `bun run test:sandbox`               | Failed before scenarios: unresolved `chromium-bidi` imports inside Playwright                                                                      | The compiled CLI gate is currently broken                                               |
| Focused adversarial/lifecycle probes | Reproduced the findings marked “reproduced” below                                                                                                  | Cases absent from the existing passing suites                                           |

The initial sandboxed source check had six loopback-listener failures. Rerunning with local sockets permitted passed; those initial failures are not repository defects. The build also reports a large-chunk warning, which is secondary to the correctness findings. No provider login, real inference, real scanner, credential-store, cross-platform native, or release/signing check was performed.

## Correctness and trust findings

### R01 · High · An inspection draft can silently become a measurement for another sample

**Location:** [capture-station.tsx](../../apps/web/src/components/capture-station.tsx), lines 33–57. **Evidence:** reproduced in Chromium.

The capture target follows live `lot.next`, while the entered value is independent local state. Enter `220.02` for C10/sample 1, then record sample 1 as `220.01` from an external caller. The screen advances to sample 2, retains the draft `220.02`, and Record commits that value to sample 2 without a conflict. A number intended for one physical sample becomes data for another. Pin lot, characteristic, sample and base revision when editing starts; external updates should preserve that identity and require explicit resolution. Test an external write during an unfinished draft, not only double-Enter during local submission. Principles: P4, P5.

### R02 · High · Quality delivery aggregates bypass plant and lot authorization

**Location:** [quality server.ts](../../examples/quality-inspection/server.ts), lines 292–321 and 372–381. **Evidence:** reproduced with ordinary domain operations and delegated contexts.

Metrics resolves the owning lot only for `result:` effects. `defect:` and `lot:` effects pass if their plant exists, bypassing accessible plants, the requested plant and the lot grant. A principal with no plant role received `forwarding.pending: 1` for someone else's defect. Separately, synchronization pending-effect filtering resolves grant scope only for `lot:` resources: a grant restricted to lot A returned B's `retrying: 1` and `oldestPendingAt`, although its record count correctly showed `pending: 0`.

Resolve every effect resource to its owning lot once, then apply the same plant, request and grant predicate before any count, timing or list. Include all effect resource kinds in the authorization matrix. Principle: P3.

### R03 · High · React can retain protected data across permission changes

**Location:** [query.ts](../../packages/react/src/query.ts), lines 86–116. **Evidence:** two deterministic reproductions.

The stream consumer awaits `applyBatch`, which awaits active query refetches. A hung normal refetch therefore prevents the consumer from reading a later authorization-reset event, leaving protected cached data visible indefinitely. Independently, the first stream event only invalidates when `previous < 0`, even if cached snapshots were produced under an older authorization revision; invalidation retains their data during refetch.

Process authorization events independently of query completion, clear protected data immediately, and compare the first stream revision with cached snapshot revisions. Retain response fences so earlier requests cannot repopulate cleared data. Tests need both a blocked refetch followed by revocation and revocation between initial query and first stream event. Principles: P3, P5.

### R04 · High · Session revocation and trusted cancellation do not reliably reach execution

**Location:** [http.ts](../../packages/adapters/src/http.ts), lines 59–60, 165–167 and 265–267; [direct.ts](../../packages/adapters/src/direct.ts), lines 25 and 45. **Evidence:** reproduced.

HTTP authenticates the session once. Revoking it while runtime authorization is awaiting does not cancel the captured context: the paused command subsequently commits and returns 200. Expiry likewise has no session-liveness check at commit. The adapters also replace an existing trusted `context.signal` with the request's signal. An already-cancelled direct context correctly returned `CANCELLED` without a request signal, but returned the protected task when supplied a fresh signal.

Bind session revocation/expiry to execution liveness and combine, rather than replace, cancellation signals. Check the resulting state at the runtime's existing final authorization/commit gate. This is about in-flight work; new requests with a revoked token are already refused. Principle: P3.

### R05 · Medium · Direct event subscriptions miss a revocation in the snapshot gap

**Location:** [direct.ts](../../packages/adapters/src/direct.ts), lines 27 and 57–76. **Evidence:** reproduced against the project/task runtime.

The numeric direct cursor omits the snapshot's authorization revision, while subscription initializes its remembered revision to `undefined`. Query as a viewer, remove that viewer's membership, then subscribe using the snapshot cursor: all now-forbidden events are filtered, the cursor advances, and no reset is emitted. Old protected data can remain cached. Carry authorization generation in the cursor or force a safe initial reset; align direct delivery with HTTP's `deliverEvents` boundary. Principle: P5.

### R06 · Medium · Expected revisions form an oracle for hidden resources

**Location:** [runtime index.ts](../../packages/runtime/src/index.ts), lines 394–397. **Evidence:** reproduced.

The runtime authorizes operation input but reads every caller-supplied `expectedRevisions` key without checking the resource grant or read policy. An editor restricted to `task:visible` cannot read a hidden task, but an allowed command on the visible task reports `CONFLICT` for hidden revision 0 and succeeds for hidden revision 1. A nonexistent hidden key at revision 0 also succeeds. Authorize precondition resources before checking their revisions, returning an indistinguishable denial for inaccessible keys. The policy cannot currently repair this independently because expected-revision keys are outside its request input. Principle: P3.

### R07 · High · The station controller can type into an unexpected screen

**Location:** [controller.ts](../../packages/station/src/controller.ts), lines 208–224. **Evidence:** reproduced with the simulator.

Screen checks happen at initial observation and declared expectation/wait steps, not before every action. Clicks capture without identifying the screen; typing and key steps do not capture. A popup introduced after the second click still received `type("R-12")`; the controller noticed the missing next target only afterwards. Check the expected screen before each click, type and key action, including the captured frame used to resolve the target. Abort to an uncertain/held state after a partial procedure. This contradicts the documented per-action gate. Principles: P6, P7.

### R08 · High · One transient reading can falsely establish remote acceptance

**Location:** [controller.ts](../../packages/station/src/controller.ts), lines 154–160, 248–250 and 282–283. **Evidence:** reproduced.

The observer uses `StabilityGate`, but the controller evaluates individual frames for convergence/readback and relevant preconditions. A profile requiring three stable recipe readings accepted a requested recipe after one confident transient misread, with the actual simulator still showing a different recipe and no action performed. Apply profile confidence and stability requirements consistently to preconditions, initial convergence checks, final readback and lookup. Acceptance must mean the requested remote state was established to the declared standard. Principles: P6, P7.

### R09 · High · Stopping delivery can lose an uncertain outcome

**Location:** [integration index.ts](../../packages/integration/src/index.ts), lines 207–215; [controller.ts](../../packages/station/src/controller.ts), lines 285–289. **Evidence:** reproduced.

The dispatcher's catch block checks `signal.aborted` before recognizing `DeliveryUncertain`. If a partly executed screen procedure is interrupted during shutdown, the uncertain outcome is discarded: the probe reported no held effect and no recorded attempt. On restart, a non-converged effect with `attempts === 0` is treated as fresh and eligible for delivery. Persist uncertainty before ending the loop, using a narrow settlement context that can finish recording the outcome after actuation cancellation. Test interruption after an actual external action. Principles: P6, P7.

### R10 · High · Vision requests can redirect screenshots outside the allowed endpoint

**Location:** [openai-compatible-vision.ts](../../packages/station/src/perception/openai-compatible-vision.ts), lines 95–102. **Evidence:** reproduced with two local fixture servers.

Only the initial endpoint is validated; fetch follows redirects. A configured `127.0.0.1` endpoint returned a 307 to `0.0.0.0`, a destination the validator directly rejects, and the second server received the screenshot POST. This proves the allowlist can be bypassed without contacting any external system during the review. Reject redirects or validate every hop before forwarding image bytes. The boundary is particularly important because the explicit hostname allowlist is the user's control over where screen content may be sent. Principles: P3, P9.

### R11 · High · Routine observations reuse keys with different payloads

**Location:** [observer.ts](../../packages/station/src/observer.ts), lines 87–103; [runtime index.ts](../../packages/runtime/src/index.ts), lines 369–389. **Evidence:** reproduced through the real runtime.

The observation key hashes content and a heartbeat window, but the input also contains changing timestamps/digests. Four normal one-second observations of a stopped simulator produced `accepted, accepted, IDEMPOTENCY_CONFLICT, IDEMPOTENCY_CONFLICT`. Returning from state A to B and back to A within the window has the same identity problem and can delay a real state transition. Existing observer tests use a stub that does not fingerprint idempotency input.

Suppress unchanged consecutive observations before invocation; assign a distinct identity to each real transition/heartbeat, and retry the exact same payload with the same key. Principles: P4, P5, P6.

### R12 · High · `drain` reports success while another integration still has work

**Location:** [cli.ts](../../apps/service/src/cli.ts), lines 153–169; [embedded.ts](../../apps/service/src/embedded.ts), lines 44–50. **Evidence:** reproduced with a persisted workspace.

The composed catalog includes line-station operations, but embedded startup and `drain` wire only the quality integration. Classifying a stop creates one pending MES effect. `drain --timeout 0` prints `{"target":"quality-system","pending":0}` and exits 0 while reopening the same workspace still shows one pending MES effect. The documented orchestration contract says a sandbox may be discarded after drain exits 0; that is unsafe for the current combined application.

Compose delivery from the application's configured integration set, aggregate remaining work, and fail explicitly for pending targets that cannot be delivered in the current host. Apply the same composition discipline to `sync`. P11's planned application separation helps, but each application's full set of effects must still be accounted for. Principles: P6, P7, P11.

### R13 · High · The distributable CLI no longer compiles

**Location:** [station-bridge.ts](../../apps/service/src/station-bridge.ts), line 82; [build-cli.ts](../../scripts/build-cli.ts), lines 17–29; [sandbox.test.ts](../../apps/service/sandbox.test.ts), lines 22–31. **Evidence:** actual `bun run test:sandbox` failure.

The production import graph now reaches Playwright through station startup. Bun compilation fails resolving `chromium-bidi/lib/cjs/bidiMapper/BidiMapper` and `chromium-bidi/lib/cjs/cdp/CdpConnection` from Playwright's bundle. Lazy runtime loading does not keep a statically discoverable dynamic import out of a standalone build. The default source check passes because it runs the source-entry variant and never compiles this binary.

Define the optional browser-station adapter's packaging boundary explicitly, repair standalone bundling, and make compilation part of the relevant required gate. Do not infer that the compiled desktop sidecar passes from the web build or packaging unit tests; its entry shares this host graph and needs its own build result. Principles: P9, P10.

### R14 · Medium · Windows staging uses POSIX-only path matching

**Location:** [package-stage.ts](../../scripts/package-stage.ts), lines 40–48 and 71–74. **Evidence:** deterministic Windows-path reproduction; no native Windows execution claimed.

`listFiles` returns native absolute paths, but runtime discovery filters for `/runtimes/codex/` and `/bin/codex.exe`. A normal `C:\...\resources\runtimes\codex\...\bin\codex.exe` matches neither predicate, so staging finds zero executables; manifest file selection has the same problem. Normalize paths once before matching or operate on path segments/relative POSIX asset names. The resource-path packaging test also hard-codes a POSIX output string, so it is not currently a portable assertion. Principle: P10.

### R15 · High · Changed sample plans can make an incomplete lot appear complete

**Location:** [quality domain.ts](../../examples/quality-inspection/domain.ts), lines 180–185; [quality server.ts](../../examples/quality-inspection/server.ts), lines 492–494. **Evidence:** reproduced.

Record sample 2 under a two-sample characteristic, then import a valid new specification requiring only sample 1. The completion count still includes the now-out-of-range sample 2: worklist says sample 1 is next but `remaining` is zero, and an accept decision succeeds. Count occupied required slots, not arbitrary active results. Decide how changed plans invalidate or reconcile prior captures, and ensure the completion predicate is shared by worklist, summary and decision. Principle: P4.

### R16 · Medium · Successful scanner connections immediately disconnect with default routes

**Location:** [use-scanner.ts](../../packages/operator-ui/src/hooks/use-scanner.ts), lines 43, 62 and 83–94. **Evidence:** Chromium with a fake Web Serial device; no hardware claim.

The default `routes = []` creates a new array per render, recreating router/connect dependencies. `setConnected(true)` triggers the connection effect's cleanup. Non-wedge connections are not automatically restarted. The fixture observed one open, one close, and `connected: false` immediately after connecting with a stable profile and omitted routes. Stabilize the default and separate routing updates from the physical device's lifecycle. Principles: P8, P9.

### R17 · Medium · Serial and GS1 parsers disagree with their own declared behavior

**Location:** [serial.ts](../../packages/devices/src/scanner/serial.ts), lines 20–22; [gs1.ts](../../packages/devices/src/scanner/gs1.ts), lines 175–184. **Evidence:** both reproduced.

A CR-only stream containing `ORDER123\r` emits nothing; the next scan emits the previous one. The final scan remains buffered indefinitely because the assembler waits for a possible LF. Emit on CR and suppress an optional following LF.

Separately, bracketed GS1 parsing skips the length checks used by the raw syntax: `(01)00` and `(10)` both return `valid: true`, despite the parser's own fixed-14 and nonempty-field definitions. Share validation between both syntaxes. These are distinct parser bugs; neither requires a physical scanner or an external standards claim to demonstrate. Principle: P9.

### R18 · Medium · A restarted perception worker never becomes ready

**Location:** [worker.ts](../../packages/station/src/perception/worker.ts), lines 65–70 and 102–107. **Evidence:** reproduced with a local JSON-lines fixture.

Failure clears `child` and `starting` but leaves `model`. The next process's handshake is handled only when `!model`, so it is ignored. The first request succeeds, the worker exits, and the next start times out. Reset process-owned state on failure and fence exit/error callbacks to their original child. Test multiple process lifetimes, not only multiple requests to one process. Principle: P9.

### R19 · Medium · Generic OIDC logout can be undone by a pending refresh

**Location:** [oidc.ts](../../packages/agents/src/oidc.ts), lines 233–259. **Evidence:** reproduced using invented credentials and a deferred token response.

Refresh reads credentials, waits for the network, then writes new credentials without generation or serialization checks. Logout can remove the entry during that wait, after which refresh restores it. The separate ChatGPT account implementation already serializes this case; the generic exported primitive does not. Share the concurrency discipline and ensure logout invalidates pending refresh writes. This finding concerns the generic OIDC primitive, not a claim that the tested ChatGPT logout path has the same defect. Principle: P3.

### R20 · Medium · Chunk-by-chunk redaction fails for streamed secrets

**Location:** [supervisor.ts](../../packages/agents/src/supervisor.ts), lines 104–121. **Evidence:** reproduced with an invented secret explicitly supplied to `redact`.

The events `sk-test123` and `456789` are individually scrubbed and persisted unchanged; concatenating them exposes the configured secret `sk-test123456789`. Keep a bounded suffix across deltas and redact before persistence and publication, or narrow the guarantee and prevent secrets reaching this stream by construction. No real credential was inspected or used. Principle: P3.

### R21 · Medium · SQLite can preserve a rolled-back seed mutation across workspaces

**Location:** [sqlite.ts](../../packages/adapters/src/sqlite.ts), lines 49–52. **Evidence:** reproduced.

`new SQLiteStorage(':memory:', () => seed)` exposes that retained seed object directly to the first transaction. Changing `count` to 9 and throwing leaves the seed mutated, so subsequent reads of both the original workspace and a fresh workspace return 9. This factory pattern appears in the repository's security tests. Clone/validate factory output before exposing it to a transaction, matching memory adapter isolation. The reference host's fresh-object factory avoids this particular trigger; the exported adapter contract does not. Principles: P4, P9.

### R22 · Medium · Scanner configuration updates discard unsaved edits

**Location:** [station-admin.tsx](../../apps/web/src/routes/station-admin.tsx), lines 51–54. **Evidence:** source-established.

`ScannerSetup` is keyed by the live configuration revision. Another caller's save unmounts it, discarding local edits and calibration state. That bypasses the intended stale-revision conflict behavior. Keep form identity stable, retain its base revision, and offer an explicit reload or conflict resolution when committed configuration changes. Principle: P5.

### R23 · Medium · The project UI cannot reach records after the first page

**Location:** [projects.tsx](../../apps/web/src/routes/projects.tsx), lines 25–31; [project server.ts](../../examples/project-tasks/server.ts), pagination helper. **Evidence:** source-established.

The UI requests only default project/task pages, whose server limit is 50, and supplies no paging/search controls. Later records become inaccessible from the screen, and completion counts derived from the displayed page undercount the project. Expose pagination or an explicit bounded-worklist design, and obtain total/completion counts from the authorized query result rather than a partial page. Principle: P1.

### R24 · Medium · Correction interfaces cannot faithfully express the domain

**Location:** [station.tsx](../../apps/web/src/routes/station.tsx), lines 300–310; [sync.tsx](../../apps/web/src/routes/sync.tsx), lines 148–155. **Evidence:** source-established.

Every uncertain station field is rendered with `NumericPad`, including textual recipe, machine-state and alarm readings. Operators cannot enter the correct textual value. Select the editor and validation from the field's declared type.

The inspection correction form separately converts an empty string with `Number('')`, producing a real zero measurement. Add a blank-value guard before conversion, matching the normal capture form. These are distinct input problems with a common lesson: preserve the difference between missing, numeric and textual values. Principles: P1, P6.

### R25 · Medium · UI-binding metadata overstates real operation coverage

**Location:** [quality contracts.ts](../../examples/quality-inspection/contracts.ts), lines 329–338; [sync.tsx](../../apps/web/src/routes/sync.tsx); [command-palette.tsx](../../apps/web/src/components/command-palette.tsx). **Evidence:** source and call-site inventory.

Batch recording and plant listing declare UI bindings without UI invocation. Result correction is reachable only through synchronization rejection rows, so an accepted but incorrect result cannot be corrected in the UI. The command palette maps prefixes to screens rather than actual executable bindings, and lacks station/device destinations.

Either provide a real interaction, declare an intentional exception, or revise the binding claim. Validate a registered binding-to-operation mapping, and cover at least one execution path per supported operation. The principles already acknowledge rendered UI coverage as a convention; this is a concrete instance where that convention has failed. Principles: P1, P2, P10.

### R26 · Medium · Captured selection context never reaches provider models

**Location:** [host.ts](../../apps/service/src/host.ts), lines 380–411; [codex.ts](../../packages/agents/src/codex.ts), line 243; [claude.ts](../../packages/agents/src/claude.ts), line 137; [ai-sdk.ts](../../packages/agents/src/ai-sdk.ts), line 44. **Evidence:** source-established across all three adapters.

The host validates and freezes `uiContext`, but providers send only `turn.prompt`; no context tool exposes the captured selection. A prompt such as “rename the selected task” therefore lacks the selected identifier even though the host stored it. Supply a minimal, authorized snapshot of the selected context through a consistent prompt/tool interface, with fresh authorization before disclosure. Keep workspace authority and credentials outside that model-facing payload. Principles: P1, P3.

### R27 · Medium · Delivery timeouts do not bound an in-progress delivery

**Location:** [integration index.ts](../../packages/integration/src/index.ts), lines 249–258. **Evidence:** reproduced.

`drain(10)` with a 120 ms connector returned after approximately 122 ms, and the connector's signal was never aborted. The deadline is checked only after a whole pass. A hung connector can hang drain indefinitely. Enforce the deadline while delivery is in flight, require adapters to honor the signal, and preserve an uncertain outcome rather than treating timeout as safe failure. Coordinate the fix with R09. Principles: P6, P7, P9.

### R28 · Medium · Completing the previous order does not advance its revision

**Location:** [line server.ts](../../examples/line-station/server.ts), lines 166–173. **Evidence:** source-established.

When an accepted recipe load activates a new order, the previous order is set to `completed`, but only the new order is passed to `ctx.change`. The previous resource has changed without a new revision/event of its own. Resource-specific subscriptions and optimistic checks cannot represent that update correctly. Mark both changed orders and include a test that observes the old order's revision and journal entry. Principles: P4, P5.

## Further bounded defects

These are worth fixing, but should not displace the higher-impact work above.

| ID  | Finding and location                                                                                                                                              | Evidence and suggested correction                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S01 | Observation provenance is dropped, [line server.ts](../../examples/line-station/server.ts), lines 542–573                                                         | Source-established: incoming frame digests are not retained on readings/attention records, and station-level profile metadata is overwritten. Preserve the frame/profile identity needed to explain an individual observation.                                                 |
| S02 | Camera lifetime has two cleanup holes, [camera.ts](../../packages/devices/src/scanner/camera.ts), lines 63–95                                                     | Source-established: decoding can emit after stop; a rejected `video.play()` can leave acquired tracks running. Fence results after cancellation and release streams in failure cleanup.                                                                                        |
| S03 | Direct receipts omit effects, [direct.ts](../../packages/adapters/src/direct.ts), lines 47–53; [client index.ts](../../packages/client/src/index.ts), lines 19–25 | Source-established: HTTP preserves runtime effect references, direct reconstruction discards them, and the client receipt type omits them. Share the serialized receipt contract.                                                                                              |
| S04 | Polling retains abort listeners, [direct.ts](../../packages/adapters/src/direct.ts), lines 80–82                                                                  | Source-established: each successful timer leaves its abort listener attached. Remove it when the timer fires, as the HTTP equivalent already does. The React reconnect delay has the same pattern.                                                                             |
| S05 | Shared backing memory defeats rollback, [runtime index.ts](../../packages/runtime/src/index.ts), lines 79–83                                                      | Reproduced: a `SharedArrayBuffer`-backed typed-array byte remained 42 after a rejected transaction. “Structured-clone compatible” is broader than isolated. Reject shared mutable buffers or narrow the supported state contract. The shipped domains use ordinary JSON state. |
| S06 | Sparse arrays pass the JSON validator, [contracts index.ts](../../packages/contracts/src/index.ts), lines 58–60                                                   | Reproduced: `new Array(1)` passes because `forEach` skips holes, then SQLite reloads it as `[null]`. Reject holes or normalize explicitly before the command boundary; do not claim lossless persistence for this input.                                                       |

## Architecture and elegance

1. **Finish the application-definition boundary already accepted in P11.** `apps/service` currently owns domain state, policies, integration principals, fakes and module selection; `apps/web` owns all example navigation/screens. Adding another application requires editing the shell. The newly added [ADR 005](../decisions/005-framework-shell-content.md) and M10 correctly acknowledge this. Move one application's complete composition behind a value supplied to the shell. Make generators, embedded/HTTP hosts, integration startup and frontend navigation consume that same definition. Prove it with two independently runnable examples. R12 and R13 demonstrate concrete consequences of today's coupling.

2. **One resource-scope function should govern both rows and aggregates.** The inspection handlers have several similar but subtly different resource-to-lot predicates. This is the source of R02, not a need for another policy framework. Normalize ownership once, then use one visibility predicate before lists, counts, timings, effects and pagination.

3. **Share event, receipt and cancellation adaptation.** HTTP and direct transports have diverged in cursor meaning, protected delivery, effect fields and signal handling. The plain live-query and TanStack implementations also differ in their revocation behavior. Extract the narrow protocol/state-machine rules that must agree; keep transport I/O and UI cache mechanics separate. Add the same adversarial conformance cases to both implementations.

4. **Treat draft identity as a first-class interaction concept.** Task editing already preserves a base revision, while inspection capture follows the live next item and scanner setup remounts on revision. A small reusable draft model containing target, base revision, local values and conflict state would prevent both R01 and R22. Do not generalize optimistic business writes to solve a local draft-lifetime problem.

5. **Make binding and scenario coverage inspectable.** A string naming a screen does not prove an operation is executable. The catalog could expose an explicit implemented binding registry/exception table, with a check that every declared UI operation is accounted for. Likewise, transport parity currently proves selected authored scenarios, not every catalog operation and edge case. Report that coverage precisely.

6. **Strengthen boundary enforcement where the docs say it is enforced.** [check-boundaries.ts](../../scripts/check-boundaries.ts), line 39, only rejects relative imports from packages into apps/examples; workspace aliases can bypass that particular check. The browser graph check is useful, but does not make the package-layer rule exhaustive. Resolve imports against package ownership, including re-exports and aliases. P11's shell-to-content rule is explicitly pending and should remain labeled that way until its gate exists.

7. **Reduce duplicated asynchronous lifecycle machinery.** Integration/observer polling, direct/HTTP delay cancellation, and OIDC/ChatGPT credential operations repeat similar mechanics with different failure handling. Extract small, independently tested lifecycle helpers only after the desired semantics are settled. A new generic supervisor framework would add more surface than these specific defects require.

8. **Name the controls that exist.** The station “seat lease” currently stores seat state without expiry or fencing. Golden checks run as separate procedures; activation does not require a certificate. [implementation-status.md](../implementation-status.md) calls the macOS artifact “final-source” in its verification table, while its final-artifact section says it predates later changes. Attach results to commit and artifact hashes, then retire superseded claims. The compiled CLI failure increases the need for exact artifact evidence.

9. **Keep the exported surface intentional.** Wildcard subpath exports expose implementation files as potential public API, while package dependencies are largely centralized at the root. That is workable for the documented whole-source scaffold, but less elegant if these become reusable published packages. Before publication, define explicit browser/server/testing entrypoints and package-owned dependencies; do not impose that packaging project on today's correctness fixes.

The documented snapshot-storage scale limit, in-memory mock upstreams, unpruned journal/receipts, absent worker fencing, unimplemented OS execution isolation, and lack of live model/device evidence are acknowledged scope limits. They were not recast as newly discovered bugs. They remain relevant when deciding whether to use the reference beyond small local workspaces.

## Recommended repair order

1. Protect data and physical actions: R01–R11 and R15, with focused regression tests at the real runtime/adapter boundaries.
2. Restore reliable distribution and completion signals: R12–R14 and R27; make the compiled gate required for the advertised binary deliverable.
3. Repair device/provider/storage lifetimes and input correctness: R16–R24 and R28.
4. Close actual UI/context coverage gaps: R25–R26.
5. Consolidate shared semantics, complete P11/M10, and tighten the evidence ledger. Address S01–S06 while touching their owning modules.

Add tests for permission changes during an await, a draft target changing while edited, a second process lifetime, a second idempotency window, an interrupted external action, a changed inspection plan and a second page of records.

**Reproduction record.** Existing-check logs are in `/tmp/agent-native-review-{check,e2e,scaffold,sandbox}.log`. Focused probes used isolated temporary workspaces and local fixtures: `agent-native-review-{runtime,session-revoke,revision-oracle,storage,host}.ts`, `review-{quality,live,capture,scanner}.ts`, `station-review-{repros,stability,worker-repro,redirect}.ts`, `agents-review-repros.ts`, and `integration-review-drain.ts` under `/tmp` (`/private/tmp` on macOS). These temporary scripts are review evidence, not committed regression tests. The scenarios and expected outcomes above provide the durable specification for those tests.

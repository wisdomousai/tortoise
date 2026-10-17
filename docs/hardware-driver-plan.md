# Hardware driver plan

Status: draft for review. Branch `hardware-drivers`, worktree `.claude/worktrees/hardware-drivers`. No code has been written yet. This file is a working plan and is removed once its content has moved into the topic guides, the primitive entries and the [implementation ledger](implementation-status.md).

## Goal

Let an application control and observe hardware through code written in the language that suits the device: Python, C#/.NET (including COM automation), C++ or anything else that can speak a small protocol over stdio or a socket. The driver code runs as its own process. The application reaches it through the ports that already exist (outbox effect, connector, observation, remote query, input source), so catalog operations, handlers, screens, agents and generated artifacts keep working unchanged.

The [edge applications guide](edge-applications.md#reaching-control-software) lists the automation-interface and local-RPC routes as not implemented. This plan implements them.

## Design summary

- **Driver process.** A driver is an executable that the host supervises. It is declared in the catalog, bound to a path by the site policy, started through a new kernel process port and restarted with a fresh handshake when it exits. Loading vendor code into the host process (FFI, native addons, edge-js) is not supported, for four reasons:
  - a crash would take down the process that holds the workspace lock;
  - COM needs its own single-threaded apartment with a message pump;
  - 32-bit COM servers cannot load into a 64-bit host;
  - device access often needs a different OS user or group.
- **Protocol.** JSON-RPC 2.0, newline-delimited, over the child's stdio. The same messages run over an mTLS socket to a driver on another machine, declared as a `site` destination and reached through the network port. The protocol generalizes the perception worker's JSON-lines protocol (`packages/station/src/perception/worker.ts`).
- **Driver contract.** Browser-safe data authored with `defineDriverContract`. It declares:
  - state fields;
  - actions, each with input and result schemas, a delivery mode, readback, preconditions, a hazard class and a timeout;
  - events: telemetry, occurrences and progress;
  - the devices, network destinations and process the driver needs.

  A generator emits JSON Schema plus Python and .NET stubs. The handshake compares the running driver's contract digest with the declared one and refuses a mismatch.
- **Mapping onto existing primitives.**

| Driver part           | Primitive                               | Adapter                                                                                    |
| --------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| Action                | Outbox effect, connector                | `createDriverConnector` implements `SystemOfRecordPort`; lookup from `action.lookup` or readback |
| `state.read`          | Remote query, readback, lookup          | `createDriverSource`, read with the caller's access and stored nowhere                         |
| Telemetry event       | Observation, ingest command             | `createDriverObserver`, with stable reads, change detection, heartbeat and device provenance  |
| Occurrence event      | Ingest command or input source route    | Attention items for alarms; routes for pedals and buttons, like scans                        |
| Progress event        | Journaled delivery attempt              | Screens show the action running                                                              |

- **Routines.** Timing-critical loops (closed-loop control, motion profiles, anything under a second) stay inside the driver, or below it in the PLC. To the framework such a routine is one action with progress events, and an interrupted run is `uncertain`. Supervisory sequences (steps of seconds or longer, with operator checkpoints) are declared as data, like station procedures, and run by the framework's gated controller one driver action per step.
- **Gate.** The gate works like the screen bridge's:
  - the bridge mode is `monitor-only` by default;
  - every action has a hazard class;
  - an `operator-present` action needs a hold-to-confirm;
  - declared preconditions must hold;
  - a `control: local` state on the device refuses remote actuation, in place of the screen's seat;
  - the driver also refuses actions in `monitor-only`, so the mode is enforced on both sides.
- **Rates.** Every committed observation is a command: a row write, a receipt and a journal entry in a journal that is now capped. So telemetry enters only after change detection and within the contract's `maxRateHz`. High-rate data stays in the driver or goes to a historian.

## Protocol

| Method          | Direction                     | Content                                                                                                                                         |
| --------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize`    | host → driver                 | Protocol version, expected contract digest, non-secret configuration, mode. Answer: driver id and version, contract digest, device identities (serial number, firmware). |
| `state.read`    | host → driver                 | Field names. Answer: values and observation time.                                                                                              |
| `action.invoke` | host → driver                 | Action, input, `effectId` (idempotency key), deadline. Errors: `rejected`, `precondition`, `transient`, `uncertain`.                           |
| `action.lookup` | host → driver                 | `effectId`. Answer: the outcome, unknown or uncertain.                                                                                          |
| `$/cancel`      | host → driver                 | Cancel a request by id.                                                                                                                         |
| `event`         | driver → host (notification)  | `session`, `seq`, `name`, `payload`, `at`, `device`. A new `session` means a restart, and the host rereads state. A gap in `seq` is reported.    |
| `health`        | host → driver                 | Liveness, at a configured interval.                                                                                                             |
| `shutdown`      | host → driver                 | Orderly stop before the process tree is killed.                                                                                                 |

The error mapping to the connector port:
- `rejected` and `precondition` settle as a business rejection;
- `transient` throws `DeliveryFailure`;
- `uncertain` throws `DeliveryUncertain`, which holds the effect.

An action that was in flight when the driver exited counts as `uncertain`, unless its delivery mode lets lookup or readback decide.

## Base branch and dependencies

This plan builds on work that is not on `main`. Merging any of these branches into `main` is the user's decision; none is scheduled.

The base is `framework-roadmap`. On 2026-10-17 `hardware-drivers` was moved onto its tip, now `535ce62`, which includes `mobile-host` through phase 5 (`796c9bf`), `os-hooks` and the roadmap work through E, with check and e2e reported green.

What the base already has:
- `HostPorts.shell` and the `child-process` platform capability;
- `packages/integration/src/dispatcher/delivery.ts`;
- the Target, Observation and Gated actuator primitive entries.

What it lacks:
- mobile-host's phase 5 kernel changes (`IdentityPort.authenticate`, `PluginInstance.publicRoutes`);
- a `processes` section in the site policy schema;
- any `SystemOfRecordPort` conformance suite in `packages/testing`.

| Branch (session)                                 | What this plan uses from it                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mobile-host` (mobile-asset-survey-showcase)     | `packages/kernel` (owned by mobile-host except the shell files), `HostPlatform` with the `child-process` capability, `assertPlatformSupports`, native-module plugins (`PluginManifest.native`, `requirePluginNativeModule`) |
| `os-hooks` (os-handlers-and-shell-port)          | The pattern for adding a kernel port: the shell port's `HostPorts` member, refusing default, late-view getter and tests                                            |
| `framework-roadmap` (edge-app-framework-roadmap) | `defineTarget`, `targetHandlers`, delivery reliability (claims with fencing, upstream-pending, cancel, dispatch recheck in `packages/integration/src/dispatcher/delivery.ts`), local inference, and the D2 connector plugins this plan lines up with |

## Part A: framework and plugins (domain-neutral)

### A1. Process port and process plugin

The port follows the shell port's pattern from `os-hooks`:
- `processes: ProcessPort` in `HostPorts`;
- `noProcesses` in the default ports, throwing `UNAVAILABLE` with a message naming the missing plugin;
- a `get processes()` member in the late view;
- tests in `packages/kernel/test/processes.test.ts`: the default refusal, one provider through the late view, and two providers refusing startup.

No in-process platform adapter is added: the mobile platform has no `child-process` capability.

**Platform behavior.** On a platform without `child-process`, a `required` process refuses startup, as `assertPlatformSupports` already does. An `optional` process degrades: the dependent feature reports itself unavailable, following the requirement's `availability`. There is no silent fallback.

- `packages/kernel/src/processes.ts`: the `ProcessPort`. `spawn(processId, { args?, signal })`:
  - starts only process IDs the catalog declares, with the executable the site policy binds;
  - gives the child an environment built from nothing: the network port's `childEnvironment(processId)` plus credentials declared for that process, read from the process plugin's scoped secret store (`PluginOpenContext.secrets`, added in mobile-host `796c9bf`);
  - kills the whole process tree on close or cancellation;
  - records start, exit and crash in the event log.

  The kernel default refuses, like the network port's.
- `HostPorts.processes`, and the default in the kernel's plugin ports.
- **Site policy:** a `processes` section binds a process ID to an absolute executable path, fixed arguments, a working directory and an optional sha256 pin. A `required` process that is not bound refuses startup. `site check` reports the same findings. This touches `packages/egress/src/policy/*`.
- `plugins/process`: provides the port, with `plugin-manifest`, `plugin` and an optional status screen. It reaches the network through `ports.network` and the audit log through `ports.eventLog`, never through imports.
- **Migration:** the perception worker (`packages/station/src/perception/worker.ts`) and the harness launches (`packages/agents/src/process.ts`, `claude.ts`) take a spawn function that the host supplies from the process port. Their entries in `egressExemptions` in `scripts/boundary-rules.ts` are removed, and the process plugin's spawner becomes the one reviewed exemption.
- **Gate:** `bun run check`. Process plugin suite:
  - an undeclared ID is refused;
  - an unbound required process refuses startup;
  - the environment is empty except for the declared variables;
  - the process tree dies on close;
  - audit records are written.

  The perception worker and harness suites pass through the port, and `test:isolated` passes.

### A2. Promotions out of `packages/station`

Hardware is the second kind of source, which is the promotion trigger both entries name. This includes the `framework-roadmap` item D1, which that session handed to this plan. The edge-app-framework-roadmap session stays out of `packages/station` and observation.

- **Convergent delivery:** observe before acting, accept if converged, check preconditions, act, read back across stable reads, hold when uncertain. It moves into `packages/integration/src/convergent/` and takes a generic observe and act pair. `packages/station/src/controller` keeps the screen gate (expected screen, forbidden regions, allowed set, seat) and calls the generic kernel.
- **Observation:** readings with provenance, stability across consecutive reads, confidence thresholds, attention items, heartbeat resubmission and payload-fingerprint idempotency keys. It moves into a new `packages/observation`: `createStationObserver` generalized, `StabilityGate` and `Extractor`. Device identity (driver id and version, device serial number, firmware) joins model identity as a provenance kind.
- **No edits to `dispatcher/delivery.ts` or `target.ts`.** The convergent kernel is called from connectors, so neither file needs to change. If one turns out to, the edge-app-framework-roadmap session is told first.
- **Gate:** the station and line-station suites pass unchanged, with no behavior change. Primitive entries are updated: Observation and Gated actuator, with their locations and gaps.

### A3. Shared connector conformance and `plugins/connector-driver`

The driver connector is a plugin, in line with the `framework-roadmap` D2 connector plugins (`connector-files`, `connector-http`, `connector-opcua`, `connector-mqtt`). Each of those is a `plugins/<name>` package on `SystemOfRecordPort`, and they share one conformance suite.

- **Shared conformance suite,** in `packages/testing`. It takes any `SystemOfRecordPort` plus a fixture target and checks:
  - idempotent delivery or a lookup before every send;
  - rejection settled as data;
  - transient failures retried;
  - an uncertain outcome held;
  - a business refusal that is not retried;
  - cancellation;
  - pull watermarks.

  Whichever session starts first writes it, and tells the other. This plan writes it at the start of phase 3 unless framework-roadmap already has.
- **`plugins/connector-driver`:** the driver contract helper, the protocol, the supervisor and the adapters. It reaches child processes through `ports.processes` and sockets through `ports.network`, never through imports. An application lists it in its three entrypoints. Public names use "driver", never "device": "device" means a paired phone or tablet in `device-link` and `hub-link`, and `packages/devices` holds scanner input sources.

| Entry                                           | Runs in            | Contents                                                                                                                   |
| ----------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `@agent-native/connector-driver/contracts`       | browser and server | `defineDriverContract`, contract digest, requirement generation (process, devices, destinations), JSON Schema emission  |
| `@agent-native/connector-driver/plugin-manifest` | browser and server | The plugin manifest: driver status module, settings                                                                      |
| `@agent-native/connector-driver/plugin`          | server             | The plugin: supervisors started in `start`, driver status, CLI verbs                                                      |
| `@agent-native/connector-driver/plugin-screens`  | browser            | A driver status screen: health, versions, contract digest, mode, held actions                                             |
| `@agent-native/connector-driver/protocol`        | server             | JSON-RPC framing, message schemas, error mapping                                                                         |
| `@agent-native/connector-driver/connect`         | server             | `createDriverConnector`, `createDriverObserver`, `createDriverSource`, `createDriverIntegration` for an application's `connect` |
| `@agent-native/connector-driver/testing`         | server             | An in-process fake driver, and the driver conformance runner that checks any driver executable against its contract    |

- **Journal cursors.** The driver adapters submit commands and keep no journal cursor. Anything in the plugin that does keep one, such as a status loop, handles `EventBatch.reset` the way `plugins/webhook/delivery.ts` does: it records the gap and continues from `batch.cursor`. Tests use a fresh `--workspace`, because SQLite storage is now row storage at schema version 2.
- **Supervisor:**
  - handshake with a timeout and a digest check;
  - health checks;
  - restart with backoff and a new session;
  - state reread after a restart;
  - a bounded event queue that reports overflow;
  - shutdown before the process tree is killed.
- **`createDriverIntegration`** declares the target with `defineTarget` (from `framework-roadmap`) and composes the connector, the observer and the source, the same way `createTargetIntegration` does for a system of record.
- **Delivery modes:**
  - `idempotent` sets `idempotentDelivery`;
  - `convergent` uses the A2 kernel with readback;
  - `once` requires `action.lookup` and holds an uncertain outcome.
- **The gate** is the A2 kernel plus the hazard class, bridge mode and the `control` state.
- **Command line:** `app driver conformance <process-id>` and `app driver status`, as CLI verbs of the connector-driver plugin.
- **Generated artifacts:** the security manifest lists each driver with its process binding, devices, destinations and actions with their hazard classes. The generated agent skill marks commands whose effects target a driver, with the hazard class.
- **Gate:** the protocol and supervisor suites, run against the fake driver:
  - handshake mismatch;
  - restart during an action, which is held;
  - a sequence gap;
  - cancellation;
  - monitor-only refusal on both sides;
  - lookup after a lost reply.

  The conformance suite passes the fake driver and fails a deliberately broken one.

### A4. Language SDKs

- **Python, `plugins/connector-driver/sdk/python`** (uv project, `agent_native_driver`):
  - asyncio JSON-RPC over stdio;
  - a decorator per action and event;
  - a stub generator from the emitted JSON Schema (pydantic models);
  - `effect_id` deduplication helpers;
  - refusal in `monitor-only`.
- **.NET, `plugins/connector-driver/sdk/dotnet`** (`AgentNative.Driver`):
  - StreamJsonRpc over stdio;
  - an STA thread with a message pump for COM;
  - generated records;
  - an x86 build target for 32-bit COM servers.
- **C++:** deferred. A header-only stdio JSON-RPC helper over nlohmann/json once someone needs it.
- **Gate:** both SDKs' sample drivers pass the A3 conformance suite in CI on macOS and Linux. The .NET COM path needs the Windows smoke test in B2.

### A5. Remote driver transport and live telemetry (later)

- **mTLS socket transport.** A driver host runs on the machine with the hardware, such as a Windows station PC with the vendor SDK. The authority connects to it through the network port's `socket`, to a declared `site` destination.
- **Live readings for gauges.** An authorized, non-journaled stream per driver resource, so a gauge can update faster than committed observations. This needs its own design pass with the reactivity owners.
- **Native-module drivers on Android.** An Expo module implementing the same contract in process, following the intent-scanner plugin. This plan owns the adapter and sends its interface to the mobile session first; the native-module API may still change after the first emulator build.

## Part B: examples (domain)

Domain contracts, drivers, simulators and screens live in the examples. Two applications use drivers, which justifies the A2 promotions and keeps `plugins/connector-driver` domain-neutral.

### B1. `quality-inspection`: measuring instrument, observe only

- A `measuring-instrument` driver contract for a scale or gauge: state (`stable`, `unit`, `value`), the `measurement.taken` occurrence and an action-free profile.
- A Python driver in `examples/quality-inspection/drivers/instrument/` using pyserial, with a device simulator. Tests run it against a pty pair (socat) on macOS and Linux, so the real serial code runs without hardware.
- `measurement.taken` becomes a proposed result for the selected characteristic, with device provenance. The inspector confirms it with one action, through the existing capture flow.
- **Gate:**
  - deterministic tests with the fake driver;
  - the Python driver passes conformance;
  - a pty-pair integration test;
  - a browser spec of the confirm flow;
  - the ledger records "pty simulation, no physical instrument".

### B2. `line-station`: automation-interface route, actuate

- A `station-automation` driver contract with the same desired-state effect as the screen route's recipe loading: `recipe.load` (convergent, with readback of the loaded recipe), preconditions (machine stopped), hazard `low`, and `alarm.raised` and counter telemetry.
- A .NET driver in `examples/line-station/drivers/automation/`, backed by a simulated automation object on every OS. On Windows it is backed by a COM-visible test server that the smoke test registers.
- The application picks the route per station in configuration: `screen` or `automation`. Domain handlers, contracts and screens do not change, which is the claim the edge guide makes.
- **Gate:**
  - the line-station suites pass with either route;
  - the .NET driver passes conformance;
  - a lost-reply test is held and then reconciled;
  - the Windows COM smoke test is recorded separately and marked skipped where it did not run.

### B3. Documentation

- `docs/edge-applications.md`: the automation-interface and local-RPC rows of the routes table, and the status table.
- `docs/operator-workstation-pattern.md`: one paragraph on the automation route next to the screen route.
- A new topic guide, `docs/hardware-drivers.md`: protocol, contract, delivery modes, routines, rates, safety position, deployment and SDK usage. This plan's content moves there.
- `docs/primitives.md`:
  - new entries for Driver contract, Driver process and Process port;
  - updated entries for Observation, Gated actuator, Connector, Requirement declaration and Site policy.
- `docs/implementation-status.md`: one entry per evidence tier.
- READMEs for `plugins/connector-driver`, `plugins/process` and `packages/observation`, with the five required sections. Updates to `packages/station`, `packages/integration`, `packages/kernel` and both examples.

## Phases

| Phase | Content                                                              | Waits for                                                         | Gate                                              |
| ----- | -------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------- |
| 1     | A1 process port, process plugin, migration                           | Met at `535ce62` | A1 gate, `bun run check`                          |
| 2     | A2 promotions (observation, convergent delivery)                     | Rebase on `framework-roadmap`                                     | A2 gate, no behavior change in station suites     |
| 3     | A3 shared conformance, `plugins/connector-driver` with the fake driver | Phases 1 and 2                                                  | A3 gate                                           |
| 4     | A4 Python SDK, B1 instrument                                         | Phase 3                                                           | A4 Python gate, B1 gate                           |
| 5     | A4 .NET SDK, B2 automation route                                     | Phase 3                                                           | A4 .NET gate, B2 gate, Windows smoke recorded     |
| 6     | B3 documentation, plan file removed                                  | Phases 4 and 5                                                    | `check:readmes`, `check:generated`, ledger entries |
| 7     | A5 remote transport, live readings, Android native-module adapter    | Agreement with the owning sessions                                | Separate plan                                     |

Phases 1 and 2 touch disjoint files and can run in parallel. Phases 4 and 5 can run in parallel as separate worktrees once phase 3 is done. Merging into `main` is the user's decision at every step.

Phases 4 and 5 can run in parallel as separate worktrees once phase 3 is merged.

## File ownership

New files this plan creates and owns:

- `plugins/connector-driver/**`
- `plugins/process/**`
- `packages/kernel/src/processes.ts`
- `packages/integration/src/convergent/**`
- `packages/observation/**`
- `examples/quality-inspection/drivers/**`
- `examples/line-station/drivers/**`
- `docs/hardware-drivers.md`
- this plan

Existing files this plan edits, after the owning branch has merged:

| File or area                                                                 | Owner                        | Edit                                                                                       |
| ---------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/kernel/src/plugin.ts`, `plugins/ports.ts`, `lifecycle.ts`, `platform.ts` | mobile-host (shell members: os-hooks) | One `processes` member each, in the shell port's form; timed after mobile-host's phase 5 commit |
| `packages/egress/src/policy/*`                                               | mobile-host has open changes | Add the `processes` binding section after those land                                        |
| `packages/integration/src/dispatcher/delivery.ts`, `target.ts`              | framework-roadmap            | None planned; any edit is announced to that session first                                  |
| `packages/station/**`                                                        | this plan (handed over)      | Call `packages/observation`, the convergent kernel and the process port                    |
| `packages/agents/src/process.ts`, `claude.ts`                                | framework-roadmap touched agents | Take the spawn function from the host; announced before the edit                       |
| `packages/testing` (new conformance file only)                               | shared                       | Shared `SystemOfRecordPort` conformance suite                                              |
| `scripts/boundary-rules.ts`                                                  | shared                       | Remove the migrated exemptions                                                             |
| `docs/edge-applications.md`, `docs/operator-workstation-pattern.md`         | this plan                    | Routes and status tables, automation route paragraph                                       |
| `docs/primitives.md`, `docs/implementation-status.md`, `docs/system-of-record-pattern.md` | shared with framework-roadmap | Only this plan's own entries                                                    |
| `package.json`, `bun.lock`                                                   | root                         | New workspaces only; regenerated after rebase, never hand-merged                           |

Out of bounds: `packages/mobile`, `packages/frame-native`, `packages/shell`, `plugins/os`, `plugins/device-link`, `plugins/hub-link`, `plugins/intent-scanner`, `plugins/managed-config`.

## Limits

- **Child-process egress.** The proxy environment confines HTTP(S) only. A driver that opens Modbus TCP, OPC UA or other raw sockets itself is contained only by the exported OS rules. The other route is a TypeScript adapter where the host owns the socket through the network port.
- **Safety.** Drivers never operate safety functions. Machine safety stays with the machine and its builder. This is not a safety-rated system.
- **Real-time.** The framework is not real-time. Control loops belong in the driver or the controller.
- **Packaging.** Drivers ship as self-contained executables (PyInstaller or Nuitka, .NET single-file), so the site binding is one path and a digest. Their lockfiles feed the SBOM. Signing and staged activation are part of the open package-lifecycle gate, not this plan.
- **Evidence tiers:**
  1. deterministic tests with the fake driver;
  2. cross-language conformance;
  3. pty simulation;
  4. Windows COM smoke test;
  5. physical hardware.

  A device type counts as supported only once it has run on that tier and the ledger records it.

## Open decisions

Recommended options first. Settled through coordination: observation goes to `packages/observation`, and the driver connector is a plugin.

1. **Where contracts are written.** In TypeScript, with generated JSON Schema and Python and .NET stubs. The alternative is a language-neutral JSON or YAML file as the source.
2. **Where the SDKs live.** Under `plugins/connector-driver/sdk/*`, next to the protocol they implement. The alternative is a top-level `sdks/` folder.
3. **Who provides the process port.** A new `plugins/process`. The alternative is folding it into `plugins/network`.

## Coordination log

2026-10-17: questions sent to the three active sessions on this repository. Answers:

- **edge-app-framework-roadmap** (`framework-roadmap`):
  - It is merging `mobile-host` and `os-hooks` into its branch; this plan builds on it once the merge is reported green.
  - Delivery reliability is done and no further dispatcher changes are planned.
  - It handed over D1 (observation into `packages/observation`) and the convergent extraction, and stays out of `packages/station`.
  - Its D2 connector plugins share one conformance suite; the driver connector joins them as a plugin.
  - `docs/edge-applications.md` and `docs/operator-workstation-pattern.md` are free. In the shared docs, only this plan's own entries change.
- **os-handlers-and-shell-port** (`os-hooks`):
  - The shell port spawns no processes and needs nothing from the process port.
  - It is not changing `HostPorts` or the lifecycle.
  - The process port copies the shell port's form.
  - Kernel files belong to mobile-host apart from the shell members.
- **mobile-asset-survey-showcase** (`mobile-host`):
  - A required process refuses startup on mobile; an optional one degrades by its `availability`, with no silent fallback.
  - Phase 5 changes `plugin.ts`, `plugins/ports.ts` and `lifecycle.ts`, so the `HostPorts` edit waits for it.
  - The native-module plugin API can be planned on, though it may change after the first emulator build. This plan owns the in-process driver adapter and sends the interface when it gets there.
  - Public names avoid "device".

2026-10-17, later:
- edge-app-framework-roadmap reported the merge green at `630675e`, and `hardware-drivers` now sits on it.
- That session is starting C4 in new files under `packages/adapters`, which doesn't overlap this plan.
- It asked to be told before `packages/agents/src/process.ts` and `claude.ts` change (phase 1).
- Phase 2 can start on this base. Phase 1's kernel edit still waits for mobile-host's phase 5 commit.
- mobile-host committed phase 5 as `796c9bf`:
  - `plugin.ts`: the public route and authenticate hooks, and `PluginOpenContext.secrets`;
  - `plugins/lifecycle.ts` and `platform.ts`: `SecretStore` and `scopedSecrets`;
  - the egress policy: the `site-hub` profile and the `tls` listen mode;
  - `plugins/ports.ts` is unchanged.

  It is not in this branch's base. Phase 1 starts once `796c9bf` reaches `framework-roadmap`, or once the user chooses another base. The process plugin reads driver credentials from its scoped secret store.
- `hardware-drivers` moved to `framework-roadmap` `8aa77bd`. Between `d17e8bb` and `8aa77bd`:
  - C4 storage (`cd3b5cb`): row storage at schema version 2 and a capped journal, with `EventBatch.reset` and `WorkspaceSnapshot.journalFloor`;
  - regenerated SBOMs;
  - the os-hooks blob file payloads.

  `796c9bf` is still not included.
- `hardware-drivers` moved to `framework-roadmap` `535ce62`, which merges mobile-host phase 5 (`796c9bf`), with check and e2e reported green. Phases 1 and 2 have what they need.

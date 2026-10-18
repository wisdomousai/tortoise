# @agent-native/connector-driver

Hardware drivers in any language behind the outbox. A driver is an executable that controls equipment (an instrument, a controller, a vendor COM server). The host starts it through the process port and talks to it with JSON-RPC 2.0, one message per line, over its stdio. Driver actions become outbox targets, and driver state becomes readings. The equipment's own code runs in the driver process, so a crash, a 32-bit COM server or a device permission never touches the process that holds the workspace.

Layer: plugins (`plugins/*`). `contracts`, `plugin-manifest` and `plugin-screens` are browser-safe; everything else is server only. Design and limits: [hardware drivers](../../docs/hardware-drivers.md).

## Wiring an application

An application declares its driver contracts once and passes the same list to both halves of the plugin:

- **Manifest:** it lists `driverPluginManifest(contracts)`. This adds:
  - the `driver.status.get` query;
  - one agent workflow per driver, naming each action's delivery mode and hazard class;
  - one host component per driver, which declares the driver's process, devices and network. The process carries the outbox target named after the contract.
- **Application definition:** it lists `processPlugin` and `createDriverPlugin({ contracts })`. The driver plugin requires the process plugin.
- **Screens:** it lists `driverScreens`, the status screen at `/drivers`.
- **`connect`:**
  1. It takes `driverServiceOf(services).supervisor(id)`.
  2. It wires each driver with `createDriverIntegration`, passing a `defineTarget` target named after the contract, the bridge mode through `control`, and optionally an ingest command for the observer.
  3. For events that should become records, it starts `createDriverEventIngest` from `observe`: one ingest command per event, keyed `driver:<id>:<session>:<seq>`. It also keeps an event-only driver running, since such a driver gets no other request. `examples/quality-inspection` wires a measuring instrument this way, starting it only when `processes.availability` says the site binds the driver.

The site policy binds each driver's process ID to an absolute executable, and optionally pins its hash. `app driver list` prints the process IDs and contract digests to bind.

## Writing a driver

A driver speaks the protocol in any language. This plugin is the language-neutral base: the contract definition, the wire protocol, the host side and the checks a driver must pass. It depends on no SDK. Each language SDK is its own package under `sdks/`, depends only on this base, and proves itself with the base's reference chamber:

- [`sdks/driver-python`](../../sdks/driver-python/README.md);
- [`sdks/driver-dotnet`](../../sdks/driver-dotnet/README.md).

An SDK answers the protocol, gates by mode, delivers once per effect with a journal, sends events and generates stubs from `app driver contract <id>`. Its host test runs `checkDriver` and `chamberConformance` against its simulated chamber as a real child process.

## Contents

| Import                                           | Runs in            | Contents                                                                                                                                                   |
| ------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/connector-driver/contracts`       | browser and server | `defineDriverContract`, `driverContractDocument` (JSON, schemas as JSON Schema), `driverComponent`, `stateValueFits`, and the status query                 |
| `@agent-native/connector-driver/plugin-manifest` | browser and server | `driverPluginManifest(contracts)`                                                                                                                          |
| `@agent-native/connector-driver/plugin`          | server             | `createDriverPlugin({ contracts, configuration?, healthMs?, backoff? })`, with the `driver list`, `driver check` and `driver contract` commands            |
| `@agent-native/connector-driver/plugin-screens`  | browser            | `driverScreens`: the status screen; also the `driver-screen` registry item                                                                                 |
| `@agent-native/connector-driver/open`            | server             | `driverServiceOf`, and the service: one supervisor per driver, status, and event and session subscriptions                                                 |
| `@agent-native/connector-driver/protocol`        | server             | The JSON-RPC connection, `DriverError` and the checked answer schemas                                                                                      |
| `@agent-native/connector-driver/supervisor`      | server             | `createDriverSupervisor`: handshake with digest check, restart with backoff, health checks, ordered events, shutdown                                       |
| `@agent-native/connector-driver/connect`         | server             | `createDriverConnector` (a `SystemOfRecordPort` over one driver), `createDriverObserver` (state as gated readings), `createDriverIntegration` (both wired), `createDriverEventIngest` (events into an ingest command) |
| `@agent-native/connector-driver/testing`         | server (tests)     | `createFakeDriver`, the protocol in process with injected faults; `checkDriver`, which checks a driver executable against its contract; `chamber`, the reference contract, and `chamberConformance`, the connector conformance suite over an SDK's simulated chamber |

A contract declares state fields, actions and events. Each action has an input schema, a delivery mode, a hazard class, a timeout, and optionally a readback and preconditions on state.

- `idempotent`: the driver deduplicates by effect ID, so a retry is safe.
- `convergent`: the host reads the readback first and accepts without acting when it already holds. After acting, it accepts only once the readback holds across the fields' `stableReads`.
- `once`: the driver answers `action.lookup`, so after a lost reply the dispatcher asks before sending again.

The contract digest is the SHA-256 of `driverContractDocument`'s canonical JSON. The stub generators write it into the driver, and the handshake refuses a driver that answers with another.

## Trust boundary

A driver is deployment code the site binds by path and optional hash. Its answers are still checked:

- a malformed answer is a protocol error, never a value;
- its stderr is drained and never shown;
- its messages are capped at 500 characters before they reach application state;
- the observer reads a value that does not fit its declared type or options as `null` with confidence 0, so it reaches the domain as uncertain, never as fact;
- `observedAt` is the host's clock, not the driver's;
- event payloads reach the ingest command as sent, and its input schema is what validates them.

The host gates every action before the driver sees it:

- monitor-only refuses everything;
- assist refuses any hazard other than `none`;
- an `operator-present` action needs `presence.confirmedBy` in its input;
- while the contract's control field shows local control, actions wait.

The connector reads the mode from the application's `control` for each action, and the mode travels with that `action.invoke`. A driver built with the SDKs refuses too, so the mode is enforced on both sides. A driver starts in monitor-only at its handshake.

An action in flight when the driver exits, times out or is cancelled fails transiently. It does not count as rejected. Its delivery mode then decides what happens:

- an idempotent action is resent;
- a once action is looked up;
- a convergent action is read back.

If the readback does not show the result, the effect is held for a person. A driver's own `uncertain` answer holds the effect at once.

The integration principal's grant names only the target's settle and status operations and the observer's ingest command. A misbehaving driver therefore cannot reach business commands. `driver.status.get` is read by the workspace owner only. A resource-limited delegated grant must name `driver:status`.

`driver check` starts an executable outside the site policy, through the process plugin's spawn, with its base environment, so nothing the host holds reaches the driver. A driver that reads a variable gets it through a wrapper, such as `/usr/bin/env INSTRUMENT_PORT=/dev/ttyUSB0 <executable>`. It never sends `action.invoke`, so it is safe against a connected unit.

Gaps:

- no remote-query source over driver state;
- no remote transport;
- the observer reports the first unit a driver lists, not each unit;
- events reach subscribers, but no adapter turns them into readings yet.

Besides the fake driver and a test script, the SDKs' simulated chambers and the examples' drivers run against simulated equipment only; none has controlled a physical unit in these tests.

## Tests

```sh
bun test plugins/connector-driver
```

- `test/conformance.test.ts` runs the shared connector conformance suite (`@agent-native/testing/connectors`) once per delivery mode against the fake driver.
- `test/driver.test.ts` covers:
  - contract validation and the digest;
  - a digest mismatch with backoff;
  - restarts with new sessions, event order and gaps;
  - exits and cancellation in flight;
  - mode refusal on both sides;
  - operator confirmation;
  - convergence without acting, local control and preconditions;
  - `uncertain` held, and a lost reply found by lookup.
- `test/plugin.test.ts` covers:
  - the manifest and its agent workflow;
  - a command forwarding to a driver composing in the catalog;
  - the service starting a driver through the process port and fanning out events past a failing listener;
  - the status policy;
  - the observer's device provenance, gate reset on restart and type checks.
- `test/events.test.ts` covers the event ingest: one command per wanted event, keyed by session and sequence, with the reporting unit; a failed ingest reported without stopping later events.
- `test/check.test.ts` runs `checkDriver` against the fake driver, and `driver check` against `test/fixtures/chamber-driver.ts` as a real child process over stdio.
Each SDK's own tests run its simulated chamber against this base; see the SDK READMEs.

## Skills

- [write-hardware-driver](skills/write-hardware-driver/SKILL.md): writing a driver contract, wiring it into an application, and writing, checking and binding the driver.

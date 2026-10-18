# @agent-native/connector-driver

This plugin puts hardware [drivers](../../docs/glossary.md#driver) in any language behind the [outbox](../../docs/glossary.md#outbox): driver actions become outbox [targets](../../docs/glossary.md#target), and driver state becomes [observations](../../docs/glossary.md#observation). A driver is an executable that controls equipment, such as an instrument, a controller or a vendor COM server. The host starts it through the [process port](../../docs/glossary.md#process-port) and talks JSON-RPC 2.0 to it over its standard streams, one message per line.

## Layer

[Host plugin](../../docs/glossary.md#host-plugin) layer. `contracts`, `plugin-manifest` and `plugin-screens` are browser-safe; everything else is server only. The equipment's own code runs in the driver process. A crash, a 32-bit COM server or a device permission therefore never touches the process that holds the workspace. The plugin trusts the executable the [deployment policy](../../docs/glossary.md#deployment-policy) binds, and still checks every answer it sends. [Hardware drivers](../../docs/hardware-drivers.md) explains the design and its limits.

## Primitives

- [Driver contract](../../docs/primitives.md#driver-contract): `defineDriverContract`, `driverContractDocument`, `driverComponent`, `driverPluginManifest`.
- [Driver process](../../docs/primitives.md#driver-process): `createDriverPlugin`, `createDriverSupervisor`, `driverServiceOf` and the protocol.
- [Connector](../../docs/primitives.md#connector) and [gated actuator](../../docs/primitives.md#gated-actuator): `createDriverConnector`, `createDriverIntegration`.
- [Observation](../../docs/primitives.md#observation): `createDriverObserver`, `createDriverEventIngest`.
- [UI registry](../../docs/primitives.md#ui-registry): the `driver-screen` item of the `agent-native-driver` registry in [`registry.json`](registry.json).

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/connector-driver` | server | `contracts`, `protocol`, `supervisor`, `connect` and `open`, re-exported. |
| `@agent-native/connector-driver/contracts` | browser and server | `defineDriverContract`, `driverContractDocument`, `driverComponent`, `stateValueFits` and the status query. |
| `@agent-native/connector-driver/plugin-manifest` | browser and server | `driverPluginManifest(contracts)`. |
| `@agent-native/connector-driver/plugin` | server | `createDriverPlugin({ contracts, configuration?, healthMs?, backoff? })`, with the `driver` CLI commands. |
| `@agent-native/connector-driver/plugin-screens` | browser | `driverScreens`: the status screen, also the `driver-screen` registry item. |
| `@agent-native/connector-driver/open` | server | `driverServiceOf` and the plugin service: one supervisor per driver, status, and event and session subscriptions. |
| `@agent-native/connector-driver/protocol` | server | The JSON-RPC connection, `DriverError` and the checked answer schemas. |
| `@agent-native/connector-driver/supervisor` | server | `createDriverSupervisor`: handshake with digest check, restart with backoff, health checks, ordered events, shutdown. |
| `@agent-native/connector-driver/connect` | server | The connector, the observer and the event ingest, listed below. |
| `@agent-native/connector-driver/testing` | server (tests) | The fake driver, the driver check and the reference chamber, listed below. |
| `@agent-native/connector-driver/server`, `/cli` | server | The status handlers and `driverPolicy`, and `driverCliCommand`. |

`driverContractDocument` is the contract as JSON, with its schemas as JSON Schema. The `driver` CLI commands are `driver list`, `driver check` and `driver contract`.

`connect` holds:

- `createDriverConnector`: a `SystemOfRecordPort` over one driver;
- `createDriverObserver`: driver state as gated observations;
- `createDriverIntegration`: the connector and the observer, wired together;
- `createDriverEventIngest`: driver events into an ingest command.

`testing` holds:

- `createFakeDriver`: the protocol in process, with injected faults;
- `checkDriver`: checks a driver executable against its contract;
- `chamber`: the reference contract;
- `chamberConformance`: the connector conformance suite over an SDK's simulated chamber.

### Wiring an application

An application declares its driver contracts once and passes the same list to the manifest and the application definition:

- **Manifest:** `driverPluginManifest(contracts)` adds the `driver.status.get` query, one agent workflow per driver and one host component per driver. Each workflow names each action's delivery mode and hazard class. Each component declares the driver's process, devices and network, and the process carries the outbox target named after the contract.
- **Application definition:** it lists `processPlugin` and `createDriverPlugin({ contracts })`. The driver plugin requires the process plugin.
- **Screens:** it lists `driverScreens`, the status screen at `/drivers`.
- **`connect`:** it wires each driver with the steps below.

In `connect`:

1. Take `driverServiceOf(services).supervisor(id)`.
2. Wire each driver with `createDriverIntegration`. Pass a `defineTarget` target named after the contract, the bridge mode through `control`, and optionally an ingest command for the observer.
3. For events that should become records, start `createDriverEventIngest` from `observe`. It submits one ingest command per event, keyed `driver:<id>:<session>:<seq>`. It also keeps an event-only driver running, since such a driver gets no other request.

`examples/quality-inspection` wires a measuring instrument this way. It starts the instrument's driver only when `processes.availability` says the site binds it.

The deployment policy binds each driver's process ID to an absolute executable, and optionally pins its hash. `app driver list` prints the process IDs and contract digests to bind.

### Driver contract

A contract declares state fields, actions and events. Each action has an input schema, a [delivery mode](../../docs/glossary.md#delivery-mode), a [hazard class](../../docs/glossary.md#hazard-class) and a timeout. It may also have a readback and preconditions on state. [Hardware drivers](../../docs/hardware-drivers.md#delivery-modes) describes the delivery modes.

The contract digest is the SHA-256 of `driverContractDocument`'s canonical JSON. The stub generators write it into the driver, and the handshake refuses a driver that answers with another.

### Driver SDKs

A driver speaks the protocol in any language. This plugin is the language-neutral base: the contract definition, the wire protocol, the host side and the checks a driver must pass. It depends on no [driver SDK](../../docs/glossary.md#driver-sdk). Each SDK is its own package under `sdks/`, depends only on this base, and proves itself with the base's reference chamber:

- [`sdks/driver-python`](../../sdks/driver-python/README.md);
- [`sdks/driver-dotnet`](../../sdks/driver-dotnet/README.md).

An SDK answers the protocol, gates by mode, delivers once per effect with a journal, sends events and generates stubs from `app driver contract <id>`. Its host test runs `checkDriver` and `chamberConformance` against its simulated chamber as a real child process.

## Trust boundary

A driver is deployment code the site binds by path and optional hash. The host still checks its answers:

- a malformed answer is a protocol error, never a value;
- its standard error is drained and never shown;
- its messages are capped at 500 characters before they reach application state;
- the observer reads a value that does not fit its declared type or options as `null` with confidence 0, so the domain treats it as uncertain;
- `observedAt` is the host's clock, not the driver's;
- event payloads reach the ingest command as sent, and its input schema validates them.

The host gates every action before the driver sees it:

- monitor-only refuses everything;
- assist refuses any hazard class other than `none`;
- an `operator-present` action needs `presence.confirmedBy` in its input;
- while the contract's control field shows local control, actions wait.

The connector reads the [bridge mode](../../docs/glossary.md#bridge-mode) from the application's `control` for each action, and the mode travels with that `action.invoke`. A driver built with an SDK refuses too, so both sides enforce the mode. A driver starts in monitor-only at its handshake.

An action in flight when the driver exits, times out or is cancelled fails transiently and does not count as rejected. Its delivery mode then decides what happens:

- an idempotent action is resent;
- a once action is looked up;
- a convergent action is read back.

If the readback does not show the result, the effect is held for a person. A driver's own `uncertain` answer holds the effect at once.

The [integration principal](../../docs/glossary.md#integration-principal)'s grant names only the target's settle and status capabilities and the observer's ingest command. A misbehaving driver therefore cannot reach business commands. Only the workspace owner reads `driver.status.get`, and a resource-limited delegated grant must name `driver:status`.

`driver check` starts an executable outside the deployment policy, through the process plugin's spawn with its base environment. Nothing the host holds reaches the driver. A driver that reads a variable gets it through a wrapper, such as `/usr/bin/env INSTRUMENT_PORT=/dev/ttyUSB0 <executable>`. The check never sends `action.invoke`, so it is safe against a connected unit.

Limits:

- no remote-query source over driver state;
- no remote transport;
- the observer reports the first unit a driver lists, not each unit;
- events reach subscribers, but no adapter turns them into observations yet.

The fake driver, a test script, the SDKs' simulated chambers and the examples' drivers run against simulated equipment only. None has controlled a physical unit in these tests.

## Dependencies

- Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/integration`, `@agent-native/observation`, `@agent-native/host` (`plugin`, `plugin-manifest`), `@agent-native/adapters/cli`, `@agent-native/frame/plugin-screens` and `@agent-native/testing/connectors`.
- Plugin: `@agent-native/process` (`spawn`).
- External: `zod`, `react`, `@tanstack/react-query` and `lucide-react`. The screen uses the starter's `@/components/ui` primitives and `@/lib/session`.

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
  - the plugin service starting a driver through the process port and fanning out events past a failing listener;
  - the status policy;
  - the observer's device provenance, gate reset on restart and type checks.
- `test/events.test.ts` covers the event ingest: one command per wanted event, keyed by session and sequence, with the reporting unit. A failed ingest is reported without stopping later events.
- `test/check.test.ts` runs `checkDriver` against the fake driver, and `driver check` against `test/fixtures/chamber-driver.ts` as a real child process over stdio.

Each SDK's own tests run its simulated chamber against this base, as the SDK READMEs describe.

## Skills

- [write-hardware-driver](skills/write-hardware-driver/SKILL.md): writing a driver contract, wiring it into an application, and writing, checking and binding the driver.

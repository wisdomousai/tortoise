# Hardware drivers

An application can observe and control equipment through a driver: an executable written in whatever language suits the equipment (Python for a serial instrument, C# for a vendor COM server, anything else that can read and write lines). The host starts the driver as a child process and speaks a small protocol to it. Driver actions are outbox targets and driver state becomes observations, so catalog operations, handlers, screens, agents and generated artifacts work as they do for any other system.

This guide covers the design. The API is in the READMEs:

- [`plugins/connector-driver`](../plugins/connector-driver/README.md): the language-neutral base, with the contract, protocol, supervisor, adapters and checks;
- [`plugins/process`](../plugins/process/README.md): the process port that starts declared executables;
- [`sdks/driver-python`](../sdks/driver-python/README.md) and [`sdks/driver-dotnet`](../sdks/driver-dotnet/README.md): libraries for driver authors.

The [operator workstation pattern](operator-workstations.md) describes the station setting this comes from. A station is reached through its screen, or through its automation interface with a driver.

## Why a separate process

Vendor code is never loaded into the host process (no FFI, native addons or in-process COM), for four reasons:

- a crash in vendor code would take down the process that holds the workspace lock;
- COM automation needs its own single-threaded apartment;
- a 32-bit COM server cannot load into a 64-bit host;
- device access often needs another OS user or group.

A driver is declared in the catalog as a process requirement. The site policy binds its process ID to an absolute executable, optionally pinned by hash, with fixed arguments and environment. The [process port](primitives.md#process-port) starts only declared and bound processes, gives each one an environment built from nothing, and kills the whole process tree on close. A required driver that is not bound refuses startup; an optional one leaves its feature unavailable.

## Protocol

JSON-RPC 2.0, one message per line, over the driver's stdin and stdout. Stderr is drained and never shown.

| Method          | Direction                    | Content                                                                                                                         |
| --------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `initialize`    | host → driver                | Protocol version, expected contract digest, non-secret configuration and mode. The answer names the driver and its units (serial, firmware, model) and echoes the digest. |
| `state.read`    | host → driver                | Field names. The answer has the values, optional confidence, and the time they were read.                                       |
| `action.invoke` | host → driver                | Action, input, effect ID, deadline and the bridge mode.                                                                         |
| `action.lookup` | host → driver                | Effect ID. The answer is the recorded outcome, `unknown` or `uncertain`.                                                        |
| `$/cancel`      | host → driver                | Cancel a request by ID.                                                                                                         |
| `event`         | driver → host (notification) | Session, sequence number, name, payload, time and unit. A new session means the driver restarted; a gap in the sequence is reported. |
| `health`        | host → driver                | Liveness, at a configured interval.                                                                                             |
| `shutdown`      | host → driver                | Orderly stop before the process tree is killed.                                                                                 |

Failures carry a kind, which decides what happens to the outbox effect:

| Kind           | Meaning                                         | Effect                                   |
| -------------- | ----------------------------------------------- | ---------------------------------------- |
| `rejected`     | The equipment refused; retrying will not help.  | Settled as a business rejection.         |
| `precondition` | The equipment is not in a state to do it now.   | Settled as a business rejection.         |
| `transient`    | Nothing was done; a retry may succeed.          | Retried with backoff.                    |
| `uncertain`    | The equipment may have acted.                   | Held for a person to reconcile.          |
| `refused`      | The mode or the driver's own rules forbid it.   | Retried, so it waits until they allow it. |

An action in flight when the driver exits is `uncertain`, unless its delivery mode lets a lookup or a readback decide.

## Driver contract

A [driver contract](primitives.md#driver-contract) is browser-safe data written with `defineDriverContract` in the application. It declares:

- state fields, with type, options, decimals, unit and the number of agreeing reads that make a value stable;
- actions, each with an input schema, a delivery mode, a hazard class, a timeout, and optionally preconditions and a readback on state;
- events, with a kind and a maximum rate;
- the `control` field that shows when someone works the equipment locally;
- the process the driver runs as.

`app driver contract <id>` writes the contract as JSON with its digest, the SHA-256 of its canonical form. The SDKs' stub generators recompute the digest, refuse a file that does not match, and write it into the driver. The handshake refuses a driver whose digest differs from the host's, so a driver built against an older contract never runs.

### Delivery modes

- **`idempotent`:** the driver deduplicates by effect ID, so a resend is safe.
- **`convergent`:** the action sets a state the host can read back. The host accepts without acting when the readback already holds, checks preconditions, acts, and accepts once the readback holds across the fields' stable reads. After a lost reply it reads back: a change the equipment shows is accepted, and anything else is held.
- **`once`:** the driver records each effect in a journal before acting and answers `action.lookup` from it, so after a lost reply the dispatcher asks before sending again. A journal entry that started and has no outcome reads as `uncertain`.

A person who reconciles a held effect as "not applied" releases it, and the next delivery sends it again.

## Gate

Actions pass the same gate as the screen bridge's procedures:

- the bridge mode is `monitor-only` by default, which refuses every action; `assist` allows only hazard `none`; `actuate` allows all;
- an `operator-present` action needs a confirmation that a person is at the equipment;
- declared preconditions must hold before the action is sent;
- while the `control` field reads local, nothing is sent;
- the application's control query can refuse delivery for its own reasons, such as the operator holding the station seat.

The SDKs check mode and presence again inside the driver, so a driver stays safe if the host's check fails.

## Timing and rates

The framework is not real-time. Timing-critical loops (closed-loop control, motion profiles, anything under a second) stay in the driver or in the controller below it. To the framework such a routine is one action, and an interrupted run is `uncertain`. Supervisory sequences, with steps of seconds or longer and operator checkpoints, are separate actions sent one at a time.

Every committed observation is a command, with a row write, a receipt and a journal entry. State enters only after stability and change detection, with a heartbeat while nothing changes, and events above their declared rate are dropped in the driver before they get a sequence number. High-rate data stays in the driver or goes to a historian.

## Writing and deploying a driver

1. Write the contract in the application, and list `driverPluginManifest`, `createDriverPlugin` and `driverScreens` with the process plugin.
2. Write the contract file with `app driver contract <id>` and generate stubs with the SDK's generator.
3. Write the driver with the SDK: a handshake handler that opens the equipment and names its units, a state reader, and a handler per action and event.
4. Check it against its contract with `app driver check <id> -- <executable>`. The check never invokes an action, so it is safe against connected equipment.
5. Ship it as a self-contained executable (PyInstaller or Nuitka, .NET single-file; `win-x86` for a 32-bit COM server), and bind its path and hash in the site policy.

## Examples

- **Measuring instrument, observe only** (`examples/quality-inspection`). A Python driver reads a gauge or balance over its serial data output. A stable reading becomes an instrument reading through an ingest command, and the inspector confirms it as a result with one action. The tests run the real serial code over a pseudo-terminal pair.
- **Station automation, actuate** (`examples/line-station`). A .NET driver reaches the station software through its COM automation server instead of its screen. It reports the same fields and loads recipes as a convergent action with the same precondition, readback and hazard as the screen procedure. The domain is the same on both routes, and a station is configured on one of them. A simulated station stands in for the COM server in the tests and the demo.

## Limits

- **Safety.** Drivers never operate safety functions. Machine guarding and safety stay with the machine and its builder; this is not a safety-rated system.
- **Child-process network.** The proxy environment confines HTTP(S) only. A driver that opens Modbus TCP, OPC UA or other raw sockets itself is contained only by the exported OS rules. The alternative is a TypeScript adapter that reaches the socket through the network port.
- **Secrets.** A process that declares secrets needs a platform secret store, and the Bun platform has none, so such a driver is unavailable there.
- **Signing.** Driver executables are pinned by hash; signing and staged activation are part of package lifecycle, which is not built.

A kind of equipment counts as supported only once it has run on real hardware or its real software and the [implementation ledger](implementation-status.md#hardware-drivers) records it.

## Not built

- a remote transport, for a driver on another machine over an mTLS socket;
- a live, non-journaled reading stream for fast gauges;
- remote queries over driver state (`createDriverSource`);
- in-process drivers on Android as Expo native modules;
- a C++ SDK.

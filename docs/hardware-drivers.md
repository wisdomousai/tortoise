# Hardware drivers

An application observes and controls equipment through a driver process. A driver connects an instrument, a controller or workstation application.

## Concepts

Terms: [driver](glossary.md#driver), [driver contract](glossary.md#driver-contract), [driver SDK](glossary.md#driver-sdk), [delivery mode](glossary.md#delivery-mode), [risk level](glossary.md#risk-level) and [interlock](glossary.md#interlock).

## Driver processes

A driver is an executable in any language that reads and writes lines, such as Python for a serial instrument or C# for a vendor COM server. The [host](glossary.md#host) starts the driver as a child process and speaks a small protocol to it. Each action in the driver's contract is an effect type of an outbox [target](glossary.md#target), and the driver's state enters as [observations](glossary.md#observation). Capabilities, handlers, screens, agents and generators therefore work as they do for any other [system of record](systems-of-record.md).

Vendor code never runs inside the host process: no FFI, no native addons and no in-process COM. The reasons:

- a crash in vendor code would take down the process that holds the workspace;
- COM automation needs its own single-threaded apartment;
- a 32-bit COM server cannot load into a 64-bit host;
- device access often needs another OS user or group.

A station is reached through its screen, or through its automation interface with a driver.

## Process binding

The driver plugin's manifest declares each driver's process as a [requirement declaration](glossary.md#requirement-declaration), carrying the target named after the contract. The [deployment policy](security-and-compliance.md#deployment-policy) binds the process ID to an absolute executable with fixed arguments and environment, optionally pinned by hash. The [process port](glossary.md#process-port) starts only declared and bound processes. The child does not inherit the host's environment, and closing it kills its whole process tree. A required driver without a binding refuses startup; an optional one leaves that driver unavailable.

## Protocol

The host and the driver exchange JSON-RPC 2.0 messages, one per line, over the driver's standard input and output. The host drains the driver's standard error and never shows it.

| Method | Sent by | Request | Response |
| --- | --- | --- | --- |
| `initialize` | host | Protocol version, expected contract digest, host configuration and bridge mode | Driver ID and version, the digest, a session ID and its units |
| `state.read` | host | Field names | Values, optional confidence per field, and the read time |
| `action.invoke` | host | Action, input, effect ID, deadline and bridge mode | The equipment's reference for what it did, and an optional result |
| `action.lookup` | host | Effect ID | The recorded outcome, `unknown` or `uncertain` |
| `$/cancel` | host | The ID of the request to cancel | None |
| `event` | driver | Session, sequence number, name, payload, time and unit | None, because it is a notification |
| `health` | host | Nothing, at a configured interval | Liveness; a failed check stops the driver |
| `shutdown` | host | Nothing | An orderly stop before the host kills the process tree |

A unit is the serial number, firmware and model the driver reports. A new session ID means the driver restarted, and the host reports a gap in the event sequence.

## Failure kinds

A driver error carries a kind, which decides what happens to the [outbox effect](glossary.md#effect). An error without a kind counts as `transient`.

| Kind | Meaning | Outcome for the effect |
| --- | --- | --- |
| `rejected` | The equipment refused, and retrying will not help. | Completed as a business rejection with the driver's code. |
| `precondition` | The equipment is not in a state to do it now. | Completed as a business rejection. |
| `transient` | Nothing was done, and a retry may succeed. | Retried with backoff. |
| `uncertain` | The equipment may have acted. | Held for a person to reconcile. |
| `refused` | The bridge mode or the driver's own rules forbid the action. | Retried, so the effect waits until the mode or the rules allow the action. |

An action in flight when the driver exits, times out or is cancelled fails transiently, as does a malformed response. Before the [dispatcher](glossary.md#dispatcher) sends that effect again, the action's delivery mode decides whether the earlier attempt took effect.

## Driver contract

A driver contract is browser-safe data written with `defineDriverContract` in the application. It declares:

- state fields, with type, options, decimals, unit, minimum confidence and the number of agreeing reads that make a value stable;
- actions, each with an input schema, a delivery mode, a risk level, a timeout, and optionally preconditions and a readback on state;
- events, each with a kind (telemetry, occurrence or progress) and a maximum rate;
- the `control` field that shows when the operator works the equipment locally;
- whether the driver supports lookups;
- the process the driver runs as, with its devices and network destinations.

A convergent action needs a readback, and a `once` action needs a driver with lookup.

`app driver contract <id>` writes the contract document and its digest as JSON. The digest is the SHA-256 of the document's canonical JSON. The SDK stub generators recompute the digest, refuse a file that does not match, and write the digest into the driver. The handshake refuses a driver that replies with another digest, so a driver built against an older contract does not run.

### Delivery modes

- **`idempotent`:** the driver deduplicates by effect ID, so a resend is safe.
- **`convergent`:** the host reads the readback first and accepts without acting when it already holds. After acting, it accepts once the readback holds across the fields' stable reads.
- **`once`:** the driver records each effect in a journal before acting and responds to `action.lookup` from it. After a lost reply, the dispatcher asks before sending again.

After a lost reply to a convergent action, the host reads back. It accepts a result the equipment shows, and otherwise holds the effect unless it knows it never acted. A person who [reconciles](glossary.md#reconciliation) a held convergent effect as not applied releases it, and the next delivery acts again.

A lookup of a `once` journal entry that started and has no outcome returns `uncertain`, which holds the effect.

## Interlock

Driver actions pass the same interlock as the screen bridge's procedures. The connector checks each effect in this order:

1. It rejects an unknown action, invalid input, or an `operator-present` action whose input lacks a confirmation that a person is at the machine.
2. The [bridge mode](glossary.md#bridge-mode) must allow the risk level: `monitor-only` refuses every action, `assist` allows only `none`, and `actuate` allows all. Otherwise the effect waits.
3. It accepts without acting when the readback already holds.
4. While the `control` field shows local control, it sends nothing, and the effect waits.
5. Unmet preconditions reject the effect, and preconditions it cannot read with confidence make the effect wait.

The application's control query supplies the bridge mode for each action. It can also refuse delivery for its own reasons; `examples/line-station` refuses while the operator holds [control](glossary.md#control-holder) of the station.

A driver starts in `monitor-only` at its handshake. Every `action.invoke` carries the mode, and the SDKs check mode and presence again inside the driver. `plugins/connector-driver/test/driver.test.ts` covers mode refusal on both sides and the operator confirmation.

## Timing and rates

The framework is not real-time. Timing-critical loops stay in the driver or the controller below it: closed-loop control, motion profiles, anything under a second. To the framework such a routine is one action. An interrupted run is held unless its delivery mode can show the outcome. Supervisory sequences, with steps of seconds or longer and operator checkpoints, are separate actions that the dispatcher sends one at a time.

Every committed observation is a command, with a row write, a receipt and a journal entry. The observer submits a state value only after it is debounced, and resends unchanged content once per heartbeat window. The SDKs drop events above their declared rate before they get a sequence number, so the host sees no gap. High-rate data stays in the driver or goes to a historian.

## Driver SDKs

The [Python SDK](../sdks/driver-python/README.md) and the [.NET SDK](../sdks/driver-dotnet/README.md) implement the protocol, and the driver author writes the handlers that touch the equipment. Both enforce the same rules:

- **Mode:** the bridge mode and the presence confirmation are checked before a handler runs.
- **Deadline:** an expired action is refused as transient without running.
- **Once per effect:** an `idempotent` or `once` action runs at most once per effect ID. A contract with `once` actions needs a journal on disk.
- **Failures:** a handler that raises anything other than a refusal reads as `uncertain`.

The reference contract is a test chamber in the plugin's `testing` entrypoint, with one action per delivery mode, a door precondition and local control. Each SDK ships a simulated chamber written against it. The SDK's host test runs the driver check and the shared connector conformance suite against that chamber as a real child process. The suite runs once per delivery mode and includes a driver crash after acting.

## Driver authoring and deployment

1. Write the contract in the application, and wire the driver and process plugins as the [connector-driver README](../plugins/connector-driver/README.md#wiring-an-application) describes.
2. Write the contract file, and generate stubs from it with the SDK's generator.
3. Write the driver with the SDK: a handshake handler that opens the equipment and names its units, a state reader, and a handler per action.
4. Check the driver against its contract. The check never sends `action.invoke`, so it is safe against connected equipment.
5. Build a self-contained executable with PyInstaller or Nuitka, or as a .NET single-file build. Use `win-x86` for a 32-bit COM server.
6. Bind the executable's path and hash in the deployment policy.

The commands for steps 2, 4 and 6:

```sh
app driver contract <id> --out <id>.json
app driver check <id> -- <absolute executable>
app driver list
```

`app driver list` prints each process ID and contract digest to bind. In a checkout, run `bun run cli driver` instead.

## Examples

### Measuring instrument

`examples/quality-inspection` observes only. A Python driver reads a gauge or balance over its serial data output, and its contract has no actions. Each stable reading becomes an instrument reading through an ingest command. The inspector records it as a result with **Use reading**. The tests run the real serial code over a pseudo-terminal pair.

### Station automation

`examples/line-station` actuates. A .NET driver reaches the workstation application through its COM automation server instead of its screen. Its contract reports the screen profile's fields. It loads recipes as a convergent `operator-present` action, with the screen procedure's precondition and readback. The domain is the same on both routes, and each station is configured on one route. A simulated station stands in for the COM server in the tests and the demo.

## Limits

- **Safety:** drivers never operate safety functions. Machine guarding and safety stay with the machine and its builder, and nothing here is safety-rated.
- **Child-process network:** the proxy environment confines HTTP and HTTPS clients only. Raw sockets that a driver opens itself, for Modbus TCP or OPC UA, are contained only by the exported OS rules; a TypeScript adapter can use the network port instead.
- **Secrets:** a process that declares secrets needs a platform secret store. The Bun platform has none, so such a driver is unavailable there.
- **Signing:** driver executables are pinned by hash only. A site bundle does not carry the executables. The executables get no signature and no staged activation.

Not built:

- a remote transport, for a driver on another machine over an mTLS socket;
- a live, non-journaled reading stream for fast gauges;
- remote queries over driver state;
- in-process drivers on Android as Expo native modules;
- a C++ SDK.

## References

- [Operator workstations](operator-workstations.md)
- [Systems of record](systems-of-record.md)
- [Security and compliance](security-and-compliance.md)
- [write-hardware-driver](../plugins/connector-driver/skills/write-hardware-driver/SKILL.md)
- [Connector-driver plugin](../plugins/connector-driver/README.md)
- [Process plugin](../plugins/process/README.md)

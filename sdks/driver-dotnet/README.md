# @agent-native/driver-sdk-dotnet

The .NET library `AgentNative.Driver`. Write a hardware driver for an agent-native host in C#. This package depends only on the protocol that `plugins/connector-driver` defines; nothing in the host depends on it.

The host starts the driver as a child process and speaks JSON-RPC 2.0 to it, one message per line, over stdin and stdout. The SDK answers the protocol; the driver author writes the handlers that touch the equipment. It targets .NET 10 and uses only the base class library: no NuGet packages, so it builds offline and a published driver has nothing extra to bundle.

## Layout

| Path                              | Contents                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/AgentNative.Driver`          | `Driver`, `Refusal`, `Journal`, `HandlerThread`, the line reader and writer, `ContractFile` and `Stubgen` |
| `src/AgentNative.Driver.Stubgen`  | The stub generator as a command                                                                |
| `tests/AgentNative.Driver.Tests`  | The SDK's own tests, as a console runner                                                       |
| `examples/ChamberSim`             | A simulated chamber implementing the base's reference contract; the host's conformance tests run it |
| `test/host.test.ts`               | The host side: builds the solution and runs the chamber against the base                       |

## Writing a driver

1. Write the contract file from the host application, and generate the stub from it:

   ```sh
   app driver contract chamber --out chamber.json
   dotnet run --project src/AgentNative.Driver.Stubgen -- chamber.json --namespace Chamber -o ChamberContract.cs
   ```

   The stub holds `ChamberContract.Digest`, `ChamberContract.Document` and a record per action input, action result and event payload, bound to the JSON names with `JsonPropertyName`. The generator recomputes the digest the way the host does (canonical JSON, SHA-256) and refuses a file whose digest does not match its document.

2. Reference `src/AgentNative.Driver`, register handlers and run:

   ```csharp
   using AgentNative.Driver;
   using Chamber;

   using var driver = new Driver(ChamberContract.Document, ChamberContract.Digest, new DriverOptions
   {
       Id = "chamber",
       Version = "1.0.0",
       Journal = @"C:\ProgramData\Chamber\journal.jsonl",
   });
   driver.OnInitialize(_ => [new Device(Serial: port.Serial, Firmware: port.Firmware)]);
   driver.OnState(_ => new Reading(new Dictionary<string, object?> { ["setpoint"] = port.Setpoint }));
   driver.Action<SetpointSetInput>("setpoint.set", (input, context) =>
   {
       if (input.Setpoint > port.Maximum) throw new Refusal(RefusalKind.Rejected, "Out of range", "OUT_OF_RANGE");
       port.WriteSetpoint(input.Setpoint);
       return null;
   });
   return await driver.RunAsync();
   ```

   `ActionAsync` takes an async handler; `context.Cancellation` is cancelled when the host sends `$/cancel`. `driver.Emit(name, payload)` sends a declared event and may be called from any thread.

### COM automation

Pass `HandlerThread = new HandlerThread()` in the options to run every handler on one dedicated thread. On Windows that thread is a single-threaded apartment (STA), which most vendor COM automation objects require; create the COM object in `OnInitialize` so it lives on that thread. Awaits inside handlers return to the same thread. The thread waits with managed waits, during which the runtime pumps COM messages, so calls and events marshalled from other apartments are dispatched. A visible ActiveX control that needs a full Win32 message loop needs a window thread of its own.

A 32-bit COM server needs a 32-bit driver: publish with `dotnet publish -r win-x86 --self-contained`, and bind that executable in the site policy.

## What the SDK enforces

The same rules as the Python SDK:

- **Mode.** The host sends its bridge mode with every action:
  - `monitor-only` refuses every action;
  - `assist` refuses any hazard other than `none`;
  - an `operator-present` action needs `presence.confirmedBy`.

  The SDK checks this before the handler runs, so the driver is safe even if the host's own check failed.

- **Deadline.** An action whose deadline has passed is refused as transient without running.
- **Once per effect.** `idempotent` and `once` actions run at most once per effect ID:
  - a repeat returns the recorded outcome;
  - `action.lookup` answers from the journal;
  - `convergent` actions are not deduplicated, because the host reads the equipment back before it resends one.
- **Journal.** `Started` is written and flushed to disk before a handler runs, and the outcome after. An effect that started and has no outcome reads as `uncertain`, and the host holds it for a person. A contract with `once` actions needs `Journal`. The file format is the Python SDK's.
- **Failures.** A handler that throws anything other than `Refusal` reads as `uncertain`, because the driver cannot tell how far the equipment got. Throw `new Refusal(RefusalKind.Transient, ...)` when you know nothing happened.
- **Events.** An event declared with `maxRateHz` is dropped above that rate before it gets a sequence number, so the host sees no gap.
- **Output.** `Console` output goes to stderr while the driver runs, so stdout carries only protocol messages. The host drains stderr and never shows it.

## Trust boundary

The driver trusts the host's configuration and the effect IDs it sends. Input validation against the contract's JSON Schema happens in the host before an action is sent; the SDK only binds the input to the stub's record and rejects one it cannot read. The journal path should be private to the driver's service account.

## Tests

```sh
dotnet run --project sdks/driver-dotnet/tests/AgentNative.Driver.Tests
bun test sdks/driver-dotnet
```

The first runs the SDK's rules without a host: gating, deduplication, the journal across a restart, serving over streams, the line reader, the handler thread, canonical JSON and the stub generator. The second runs from the repository root as part of `bun run check`. It builds the solution into a temporary artifacts directory, so no `bin` or `obj` lands in the tree, and runs the unit tests. It checks that the committed `ChamberContract.cs` is what the generator writes from the base's reference contract (`chamber` in `@agent-native/connector-driver/testing`). Then it checks the simulated chamber with `checkDriver` and runs `chamberConformance` against it as a real child process for each delivery mode, including a driver crash after acting. It is skipped when `dotnet` is not on PATH.

Not run here: the STA apartment and COM interop, which need Windows, and a `win-x86` build.

## Skills

- [write-hardware-driver](../../plugins/connector-driver/skills/write-hardware-driver/SKILL.md): driver contracts, SDKs and driver checks.

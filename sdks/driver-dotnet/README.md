# @tortoise/driver-sdk-dotnet

`Tortoise.Driver`: write a hardware driver in C#. The SDK speaks the driver protocol; you write the handlers that touch the equipment. The driver trusts the host's configuration and the effect IDs it sends; the host validates input against the contract's JSON Schema before it sends an action.

## Writing a driver

Write the contract file from the host application and generate the stub from it:

```sh
app driver contract chamber --out chamber.json
dotnet run --project src/Tortoise.Driver.Stubgen -- chamber.json --namespace Chamber -o ChamberContract.cs
```

The stub contains `ChamberContract.Digest`, `ChamberContract.Document` and a record per action input, action result and event payload, bound to the JSON names with `JsonPropertyName`. The generator recomputes the digest the way the host does (canonical JSON, SHA-256) and refuses a file whose digest does not match its document. Then reference `src/Tortoise.Driver`, register handlers and run:

```csharp
using Tortoise.Driver;
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

`ActionAsync` takes an async handler. `$/cancel` from the host cancels `context.Cancellation`. `driver.Emit(name, payload)` sends a declared event from any thread.

- Primitives: [Driver SDK](../../docs/primitives.md#driver-sdk).

## References

- [write-hardware-driver](../../plugins/connector-driver/skills/write-hardware-driver/SKILL.md)
- [Hardware drivers](../../docs/hardware-drivers.md)
- Test: `dotnet run --project sdks/driver-dotnet/tests/Tortoise.Driver.Tests`, `bun test sdks/driver-dotnet`

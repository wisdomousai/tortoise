# @tortoise/driver-sdk-dotnet

`Tortoise.Driver` implements the hardware-driver protocol for C# processes. `Driver` dispatches host requests to registered equipment handlers over JSON-RPC. The host validates action input against its contract before sending it. The driver supplies equipment-specific behavior under the configured process binding.

## Writing a driver

Export the application's driver contract with `app driver contract <id> --out <file>`. From this SDK directory, generate C# bindings:

```sh
dotnet run --project src/Tortoise.Driver.Stubgen -- <contract-file> --namespace <namespace> -o <output-file>
```

The generated contract exposes its document and digest. Payload records use `JsonPropertyName` to retain the contract's field names. Stub generation recomputes the canonical JSON digest and refuses inconsistent input.

Reference `src/Tortoise.Driver` from the driver project. Construct `Driver` with the generated document and `DriverOptions`. `OnInitialize` registers equipment setup. `OnState` handles the requested field reads. `Action<TInput>` registers a synchronous action handler, and `ActionAsync<TInput>` accepts an asynchronous handler.

The action context contains its cancellation token; a host `$/cancel` request signals it. `Refusal` returns a protocol refusal to the host. `Emit` sends a declared event from an equipment-reading thread. `RunAsync` starts the standard-input protocol loop and returns its process exit result. Keep diagnostic output off the protocol stream.

The [driver task guide](../../plugins/connector-driver/skills/write-hardware-driver/SKILL.md) describes host composition. The [protocol guide](../../docs/hardware-drivers.md) defines delivery modes and lookup requirements. From the repository root, run the SDK checks with `dotnet run --project sdks/driver-dotnet/tests/Tortoise.Driver.Tests` or the host contract suite with `bun test sdks/driver-dotnet`.

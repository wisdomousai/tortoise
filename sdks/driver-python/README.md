# @tortoise/driver-sdk-python

`tortoise-driver` implements the hardware-driver protocol for Python processes. `Driver` dispatches host requests to registered equipment handlers over JSON-RPC. The host validates action inputs against its declared contract before sending them. The SDK checks the protocol and contract digest; action handlers remain responsible for equipment-specific refusal and effects.

## Writing a driver

Export the application's driver contract with `app driver contract <id> --out <file>`. Generate Python bindings from that file:

```sh
python -m tortoise_driver.stubgen <contract-file> -o <output-file>
```

The generated module contains `DIGEST` and `CONTRACT`. Typed payload definitions correspond to the contract's action and event schemas. The generator recomputes the canonical JSON digest and refuses a file whose declared digest does not match its document.

Construct `Driver` with that contract and the driver's identity. Register equipment initialization with `on_initialize` and requested field reads with `on_state`. `action(name)` registers a handler for a declared action. A handler can be synchronous or return a coroutine. Its context identifies the effect being executed.

Configure the journal path for delivery modes that need persistent effect lookup. `Refusal` reports a declared refusal category to the host. `emit(name, payload)` sends a declared event from an equipment-reading thread. `run()` starts the protocol loop on standard input and output; diagnostic output must not corrupt that stream.

The [driver task guide](../../plugins/connector-driver/skills/write-hardware-driver/SKILL.md) covers contract changes and host binding. The [protocol guide](../../docs/hardware-drivers.md) specifies delivery semantics. From the repository root, `bun test sdks/driver-python` runs the simulated-driver contract checks.

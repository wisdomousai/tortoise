---
name: write-hardware-driver
description: Observe or control equipment from an agent-native application through a driver process. Use when connecting an instrument, controller, PLC gateway, test bench or vendor automation server (serial, COM, a vendor SDK), when writing a driver contract with defineDriverContract, wiring driverPluginManifest, createDriverPlugin and driverScreens into an application, or writing a driver in Python (sdks/driver-python) or C# (sdks/driver-dotnet). Covers plugins/connector-driver, plugins/process, sdks/* and the driver parts of showcase/examples/quality-inspection and showcase/examples/winding-line.
---

# Write a hardware driver

A driver is an executable in any language. The host starts it as a child process through the process port and speaks JSON-RPC over stdin and stdout. Driver actions are delivered as outbox effects on a target, and driver state becomes observations. Commands, handlers, screens and agents then work as they do for any other system of record.

## Before writing

- Drivers never operate safety functions.
- The framework is not real-time. A timing-critical loop stays inside the driver or the controller below it, and is one action to the framework.
- High-rate data stays in the driver or goes to a historian.
- A station whose software has an automation interface is reached through a driver. A station reachable only through its screen uses the `bridge-station-screen` skill (`workstations/screen-bridge/skills/bridge-station-screen/SKILL.md`).
- Choose each action's [delivery mode](../../../../docs/hardware-drivers.md#delivery-modes) from what the equipment can prove:
  - `idempotent` when the driver can deduplicate by effect ID;
  - `convergent` when a readback shows the result;
  - `once` with a journal otherwise.
- Give each action a risk level. The bridge mode defaults to `monitor-only`, which refuses every action.

## Steps

1. Write the driver contract in the application with `defineDriverContract`. It holds:
   - state fields with units and stable reads;
   - actions with input schema, mode, risk level, timeout, preconditions and readback;
   - events with a maximum rate;
   - the `control` field and the process.
2. Wire the application as in [Wiring an application](../../README.md#wiring-an-application):
   - `driverPluginManifest(contracts)` in the manifest;
   - `processPlugin` and `createDriverPlugin({ contracts })` in the application definition;
   - `driverScreens` in the screens.
3. In `connect`, add a `createDriverIntegration` per driver, with a `defineTarget` target named after the contract.
4. Route events that should become records through `createDriverEventIngest`.
5. Write the contract file with `app driver contract <id> --out <id>.json`. In a checkout, run `bun run cli driver contract <id> --out <id>.json`.
6. Run the SDK's stub generator on that file. The digest is written into the driver, and the handshake refuses a driver built against another contract.
7. Write the driver as the SDK README's "Writing a driver" describes. The SDKs gate by mode and presence again inside the driver.
   - [Python](../../../../sdks/driver-python/README.md#writing-a-driver): serial instruments and scripting.
   - [.NET](../../../../sdks/driver-dotnet/README.md#writing-a-driver): COM automation on an STA thread, with a `win-x86` build for a 32-bit COM server.
8. Check the driver with `app driver check <id> -- <executable>`. The check never invokes an action, so it is safe against connected equipment.
9. Build a self-contained executable with PyInstaller, Nuitka or a .NET single-file build.
10. Print the process IDs and contract digests to bind with `app driver list`.
11. Bind the driver's process ID to the executable's absolute path and hash in the deployment policy. The `deploy-to-site` skill (`plugins/site/skills/deploy-to-site/SKILL.md`) covers the policy.
   - The driver starts with no `PATH` or `PYTHONPATH`, and the policy may not set them, because they change what code the child loads. Pass the absolute path of each program the driver runs as a variable in the binding's `env`.
   - A driver bound to an interpreter instead of a built executable needs the SDK installed in that interpreter's environment, such as a virtual environment's `python`.

`showcase/examples/quality-inspection` reads a measuring instrument with a Python driver, observe only. `showcase/examples/winding-line` loads recipes through a .NET driver as a convergent action, in actuate mode.

## Checks

1. Run the tests. The SDK tests need `python3` and `dotnet` on `PATH` and are skipped otherwise.

   ```sh
   bun test plugins/connector-driver plugins/process
   bun test sdks/driver-python sdks/driver-dotnet
   bun test showcase/examples/<app>
   ```

2. Test the application's wiring with `createFakeDriver` from `@agent-native/connector-driver/testing`, which injects faults in process.
3. Prove a new SDK with `checkDriver` and `chamberConformance` against its simulated chamber, run as a real child process.
4. Record a run against real hardware or its real software in [implementation status](../../../../docs/implementation-status.md#hardware-drivers), with its platform and what it did not show. A kind of equipment counts as supported only after such a run.
5. Record simulator and pseudo-terminal runs as such.

## References

- [Hardware drivers](../../../../docs/hardware-drivers.md)
- [`@agent-native/connector-driver`](../../README.md)

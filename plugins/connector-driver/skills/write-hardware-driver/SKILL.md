---
name: write-hardware-driver
description: Observe or control equipment from an agent-native application through a driver process. Use when connecting an instrument, controller, PLC gateway, test bench or vendor automation server (serial, COM, a vendor SDK), when writing a driver contract with defineDriverContract, wiring driverPluginManifest, createDriverPlugin and driverScreens into an application, or writing a driver in Python (sdks/driver-python) or C# (sdks/driver-dotnet). Covers plugins/connector-driver, plugins/process, sdks/* and the driver parts of examples/quality-inspection and examples/line-station.
---

# Write a hardware driver

A driver is an executable in whatever language suits the equipment. The host starts it as a child process through the process port and speaks JSON-RPC over stdin and stdout. Driver actions are outbox targets and driver state becomes observations, so commands, handlers, screens and agents work as they do for any other system of record. [Hardware drivers](../../../../docs/hardware-drivers.md) holds the design, the protocol and the gate; the [connector-driver README](../../README.md) holds the API.

## Before writing

- Drivers never operate safety functions, and the framework is not real-time. A timing-critical loop stays inside the driver or the controller below it and is one action to the framework. High-rate data stays in the driver or goes to a historian.
- Prefer a deterministic route. A station whose software has an automation interface is reached through a driver; one reachable only through its screen uses the `bridge-station-screen` skill (`packages/station/skills/bridge-station-screen/SKILL.md`).
- Choose each action's delivery mode from what the equipment can prove ([delivery modes](../../../../docs/hardware-drivers.md#delivery-modes)): `idempotent` when the driver can deduplicate by effect ID, `convergent` when a readback shows the result, `once` with a journal otherwise. Give each action a hazard class; the bridge mode defaults to `monitor-only`, which refuses every action.

## Steps

1. **Contract.** Write it in the application with `defineDriverContract`: state fields with units and stable reads, actions with input schema, mode, hazard, timeout, preconditions and readback, events with a maximum rate, the `control` field and the process.
2. **Wire the application** as in [Wiring an application](../../README.md#wiring-an-application): `driverPluginManifest(contracts)` in the manifest, `processPlugin` and `createDriverPlugin({ contracts })` in the application definition, `driverScreens` in the screens, and in `connect` a `createDriverIntegration` per driver with a `defineTarget` target named after the contract. Events that should become records go through `createDriverEventIngest`.
3. **Contract file and stub.** Run `app driver contract <id> --out <id>.json` (in a checkout, `bun run cli driver contract <id> --out <id>.json`), then the SDK's stub generator. The digest is written into the driver, and the handshake refuses a driver built against another contract.
4. **Driver.** Follow the SDK README's "Writing a driver": [Python](../../../../sdks/driver-python/README.md#writing-a-driver) for serial instruments and scripting, [.NET](../../../../sdks/driver-dotnet/README.md#writing-a-driver) for COM automation on an STA thread and a `win-x86` build for a 32-bit COM server. The SDKs gate by mode and presence again inside the driver.
5. **Check it** with `app driver check <id> -- <executable>`. The check never invokes an action, so it is safe against connected equipment.
6. **Ship and bind.** Build a self-contained executable (PyInstaller or Nuitka, .NET single-file) and bind its process ID to the absolute path and hash in the site policy. `app driver list` prints the process IDs and contract digests to bind. The `deploy-to-site` skill (`plugins/site/skills/deploy-to-site/SKILL.md`) covers the policy.

`examples/quality-inspection` reads a measuring instrument with a Python driver (observe only), and `examples/line-station` loads recipes through a .NET driver as a convergent action (actuate).

## Checks

```sh
bun test plugins/connector-driver plugins/process
bun test sdks/driver-python sdks/driver-dotnet   # need python3 and dotnet on PATH; skipped otherwise
bun test examples/<app>
```

Test the application's wiring with `createFakeDriver` from `@agent-native/connector-driver/testing`, which injects faults in process. A new SDK proves itself with `checkDriver` and `chamberConformance` against its simulated chamber as a real child process.

A kind of equipment counts as supported only once it has run against real hardware or its real software. Record that run, its platform and what was not shown in [implementation status](../../../../docs/implementation-status.md#hardware-drivers); simulator and pseudo-terminal runs are recorded as such.

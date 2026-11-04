# @tortoise/connector-driver

Puts hardware drivers written in any language behind the outbox: driver actions become outbox targets, driver state becomes observations, and the host runs the driver through the process port over JSON-RPC.

## Wiring an application

1. Declare each contract with `defineDriverContract`.
2. Pass the same list to `driverPluginManifest(contracts)` in the manifest and to `createDriverPlugin({ contracts })` in the application definition, after `processPlugin`. `driverScreens` adds the status screen at `/drivers`.
3. In `connect`, `createDriverIntegration` wires each driver to a target named after its contract and reads the bridge mode from the application's `control` before every action.
4. In the deployment policy, bind each driver's process ID to an absolute executable, optionally pinned by hash. `app driver list` prints the IDs and digests to bind.

Primitives:

- [Driver contract](../../docs/primitives.md#driver-contract)
- [Driver process](../../docs/primitives.md#driver-process)
- [Connector](../../docs/primitives.md#connector)
- [Action checks](../../docs/primitives.md#action-checks)
- [Observation](../../docs/primitives.md#observation)
- [UI registry](../../docs/primitives.md#ui-registry)

## References

- [write-hardware-driver](skills/write-hardware-driver/SKILL.md)
- [Hardware drivers](../../docs/hardware-drivers.md)
- `bun test plugins/connector-driver`

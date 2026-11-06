# @tortoise/connector-driver

`@tortoise/connector-driver` supervises driver processes declared by an application. The process port starts the configured executable and the supervisor communicates with it over JSON-RPC. Declared actions are delivered through outbox targets. Driver readings enter the application through observation commands.

The driver contract identifies the protocol and action schemas. Before acting, the connector checks the application's current bridge mode and control state. The [hardware-driver guide](../../docs/hardware-drivers.md) specifies delivery outcomes and the readback requirements.

## Wiring an application

Declare each contract with `defineDriverContract`.

Pass the same list to `driverPluginManifest(contracts)` in the manifest and to `createDriverPlugin({ contracts })` in the application definition, after `processPlugin`. `driverScreens` adds the status screen at `/drivers`.

In `connect`, `createDriverIntegration` wires each driver to a target named after its contract and reads the bridge mode from the application's `control` before every action.

In the deployment policy, bind each driver's process ID to an absolute executable, optionally pinned by hash. `app driver list` prints the IDs and digests to bind.

## References

[write-hardware-driver](skills/write-hardware-driver/SKILL.md)

[Hardware drivers](../../docs/hardware-drivers.md)

`bun test plugins/connector-driver`

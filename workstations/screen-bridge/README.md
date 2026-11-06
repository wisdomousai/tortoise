# @tortoise/screen-bridge

`@tortoise/screen-bridge` connects to workstation software through its screen interface. `createStationObserver` extracts readings and submits stable observations to an application command. `createStationConnector` delivers declared procedures through the outbox.

A procedure's outcome depends on its configured readback. The bridge checks current control and bridge mode before acting. Reading provenance identifies the captured frame and extractor used for the observation. The package does not control a PLC directly.

## References

[bridge-station-screen](skills/bridge-station-screen/SKILL.md)

[Operator workstations](../../docs/operator-workstations.md)

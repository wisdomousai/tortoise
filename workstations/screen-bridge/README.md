# @tortoise/screen-bridge

Reads a workstation application through its screen and operates it. Readings come in as observations (`createStationObserver`); actions go out through the outbox (`createStationConnector`) and count only after a stable readback. The bridge reaches the workstation application only through its ports, and each reading records its source, model identity, frame digest, time and confidence.

- Primitives: [Observation](../../docs/primitives.md#observation), [Interlock](../../docs/primitives.md#interlock), [Connector](../../docs/primitives.md#connector), [Station profile](../../docs/primitives.md#station-and-scanner-profiles), [Golden test](../../docs/primitives.md#golden-test).

## References

- [bridge-station-screen](skills/bridge-station-screen/SKILL.md)
- [Operator workstations](../../docs/operator-workstations.md)

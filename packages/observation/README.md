# @tortoise/observation

Turns readings from things you cannot query (a vendor screen through OCR, an instrument through a driver) into observations, submitted through the application's ingest command. It never writes storage directly. An observer submits as the principal in its `context`; grant that principal the ingest capability only.

- Primitives: [Observation](../../docs/primitives.md#observation).

## References

- [observe-plant-signals](skills/observe-plant-signals/SKILL.md)
- [Operator workstations](../../docs/operator-workstations.md), [Hardware drivers](../../docs/hardware-drivers.md)
- Test: `bun test packages/observation workstations/screen-bridge`

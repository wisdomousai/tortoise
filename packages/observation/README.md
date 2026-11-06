# @tortoise/observation

`@tortoise/observation` submits stable readings through an application's ingest command. `createObserver` takes an extractor and the trusted context under which the resulting observation is submitted. A reading includes provenance identifying the source and the measurement.

The debouncer applies the configured confidence and consecutive-read requirements before submission. Observers do not write workspace storage. Their principal needs access to the declared ingest operation, and the application decides how that operation changes its records.

## References

[observe-plant-signals](skills/observe-plant-signals/SKILL.md)

[Operator workstations](../../docs/operator-workstations.md), [Hardware drivers](../../docs/hardware-drivers.md)

Test: `bun test packages/observation workstations/screen-bridge`

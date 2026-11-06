# Quality inspection

This hypothetical inspection application records measurements and defects against lots supplied by its quality-system port. A capture commits locally before the port returns its external outcome. A correction records a subsequent result while preserving the original.

Development uses `FakeQualitySystem`. The optional instrument-driver evidence comes from a simulator; it does not establish operation on physical equipment.

```sh
cd showcase/examples/quality-inspection
bun run dev:web
```

## What to try

Open **Lots** (port 4322), choose a lot and enter a value; the fake quality system accepts or rejects it.

Start with `DEMO_QUALITY_LOCKED_LOTS=4000002 bun run dev:web`, capture against lot 4000002, and send a correction from **Needs attention**.

`DEMO_QUALITY_UNAVAILABLE=1` simulates a transient outage and leaves the capture queued.

`bun run test:sandbox` compiles this app's CLI and runs it in an empty environment.

## References

[Hardware drivers](../../../docs/hardware-drivers.md)

Real parts and stand-ins: [implementation status](../../../docs/implementation-status.md#hardware-drivers)

`bun test showcase/examples/quality-inspection`, `bunx playwright test showcase/examples/quality-inspection/e2e`

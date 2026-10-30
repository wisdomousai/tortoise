# Quality inspection

An inspector records measurements or defect codes for a lot. A quality system owns the lot and decides whether to accept each result; the application commits each capture locally, queues delivery and shows the decision when it returns. An inspector corrects a rejected result without erasing the original. `FakeQualitySystem` stands in during development, and the optional serial instrument driver has run against a simulator, not real equipment.

```sh
cd showcase/examples/quality-inspection
bun run dev:web
```

## What to try

- Open **Lots** (port 4322), choose a lot and enter a value; the fake quality system accepts or rejects it.
- Start with `DEMO_QUALITY_LOCKED_LOTS=4000002 bun run dev:web`, capture against lot 4000002, and send a correction from **Needs attention**.
- `DEMO_QUALITY_UNAVAILABLE=1` simulates a transient outage and leaves the capture queued.
- `bun run test:sandbox` compiles this app's CLI and runs it in an empty environment.

## References

- Primitives: [outbox effect](../../../docs/primitives.md#outbox-effect), [driver process](../../../docs/primitives.md#driver-process)
- [Hardware drivers](../../../docs/hardware-drivers.md)
- Real parts and stand-ins: [implementation status](../../../docs/implementation-status.md#hardware-drivers)
- `bun test showcase/examples/quality-inspection`, `bunx playwright test showcase/examples/quality-inspection/e2e`

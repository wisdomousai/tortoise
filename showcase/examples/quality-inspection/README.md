# Quality inspection

An inspector records measurements or defect codes for a lot. A quality system owns the lot and decides whether to accept each result. The application commits each capture locally, queues delivery, and shows the external decision when it returns. A rejected result can be corrected without erasing the original.

The development application uses `FakeQualitySystem`, an in-memory stand-in. The example also has an optional serial instrument [driver process](../../../docs/primitives.md#driver-process); the driver has been exercised with a simulator, not real equipment.

## Try the example

From the repository root, start the browser version:

```sh
cd showcase/examples/quality-inspection
bun run dev:web
```

The demo listens on port 4322. Open **Lots**, choose a lot and enter a value on the capture screen. The fake quality system supplies the lots and accepts or rejects the result. To exercise a rejection, start with `DEMO_QUALITY_LOCKED_LOTS=4000002 bun run dev:web`; capture against lot 4000002 and use **Needs attention** to send a correction. `DEMO_QUALITY_UNAVAILABLE=1` simulates a transient outage. `bun run dev` opens the desktop version.

## From measurement to accepted result

1. Inbound sync imports lot snapshots and code groups from the quality system. The application keeps local results and its own lot state when later snapshots arrive.
2. An inspector enters a value or code. The policy checks the inspector's role for the lot's plant. The handler checks the lot, characteristic, limits and measurement time, then selects the sample.
3. The command commits the result, its revision and an [outbox effect](../../../docs/primitives.md#outbox-effect) together. The receipt proves the local write only; the result remains pending while the dispatcher delivers it.
4. The quality system returns acceptance with a reference, a rejection such as `LOT_LOCKED`, or a transient failure. Completion records the decision, and the screen refreshes. Transient failures are retried.
5. An inspector can correct a rejected result. The correction appends a superseding result and queues another delivery. Defects and usage decisions use the same delivery path, but this example has no correction command for those two kinds.

[`handlers/capture.ts`](handlers/capture.ts) checks capture requests; [`server/append-result.ts`](server/append-result.ts) records results and enqueues delivery. [`handlers/integration.ts`](handlers/integration.ts) applies imported data and completion outcomes.

## Measuring instrument

The capture station can read a gauge or balance through its serial data output. The instrument only reports, and its contract has no actions. The inspector presses the instrument's data button, and the capture station offers the reading above the value field.

A reading is not a result until a person confirms it. The instrument does not know the part or characteristic it measured. The instance refuses a confirmation when:

- the reading was already used;
- it is older than 10 minutes;
- it is in another unit than the characteristic;
- its value or time differs from the reading on screen.

The driver is optional. Without a deployment policy binding for the `instrument-driver` process, nothing starts and the capture station looks as before. To run it, install the SDK (`sdks/driver-python`) and `pyserial` into a Python environment. Then bind the process in the deployment policy:

```json
{
  "processes": {
    "instrument-driver": {
      "executable": "/opt/instrument/venv/bin/python",
      "args": ["/opt/instrument/instrument_driver.py"],
      "env": { "INSTRUMENT_PORT": "/dev/ttyUSB0", "INSTRUMENT_ID": "GAUGE-0042" }
    }
  }
}
```

`instrument_contract.py` is generated from `contracts/instrument.ts` with the SDK's stub generator, and a test fails when the two differ. `simulator.py` puts a simulated instrument on a pseudo-terminal pair for tests and demos.

## Trust boundary

Plant roles come from state. Handlers scope lots and results to the caller's plants before filtering, counting and pagination.

The quality-system integration runs as its own principal (`INTEGRATION_PRINCIPAL`), whose grant can sync and complete but cannot capture. The instrument driver runs as another principal (`INSTRUMENT_PRINCIPAL`), which can only report readings. Readings are visible to people who capture at some plant.

A peer's service principal, `peer:<id>`, may only create inspection requests and read the feed, which returns only the requests that peer created. A peer acting on behalf of a person runs as the person the subject is mapped to, with that person's plant roles, and may only list and read lots. Inspection requests belong to no plant: everyone who captures at some plant sees and closes them.

A commit [receipt](../../../docs/glossary.md#receipt) proves the local write only. The sync badge and the Synchronization screen show whether the system of record has accepted it. Capture telemetry does not influence authorization.

## Limits

- **Fake quality system.** `FakeQualitySystem` is in memory and per process, and no real quality system has run against this example. Its documents and feed are gone when the process exits.
- **Instrument hardware.** The Python driver has run only against its pseudo-terminal simulator, on macOS. The driver tests skip without `python3` and `pyserial`, and the browser spec skips without uv and a cached `pyserial`.
- **Lost driver events.** A failed ingest is reported and not retried. The supervisor's sequence check reports events the driver lost.
- **Instrument readings.** The application keeps only the newest 20 instrument readings.
- **Corrections.** Only results can be corrected. A rejected defect or usage decision has no command in the application, and the Needs attention screen says to follow it up in the quality system.
- **Usage decisions.** No command reverts a decision, and capture stops once a lot is decided or closed.
- **Measurement age.** The instance refuses a measurement more than 24 hours old. A batch holds at most 100 measurements for one lot.
- **Held effects.** The example composes no reconciliation capabilities, so a held effect has no screen or command a person can use. The dispatcher holds an effect when the principal that committed it may no longer run its command at the first claim.
- **Uncertain deliveries.** The fake quality system is idempotent by effect ID and never reports an uncertain outcome. A real connector can also cause held effects for uncertain deliveries and lost acknowledgements.
- **Inspection request plants.** An inspection request names no plant, so everyone who captures at some plant sees every request.
- **State versions.** The example declares no numbered state migrations. Its `upgradeState` fills fields that older state lacks.

## Checks

Run from the repository root:

```sh
bun test showcase/examples/quality-inspection
bun run test:sandbox
bunx playwright test showcase/examples/quality-inspection/e2e
```

`test/instrument.test.ts` checks reading confirmation with a fake driver; `test/instrument-driver.test.ts` uses the Python driver and a pseudo-terminal when its dependencies are available. The browser suite exercises capture and simulated instrument input. These checks do not establish a real quality-system or hardware connection; see [implementation status](../../../docs/implementation-status.md#hardware-drivers).

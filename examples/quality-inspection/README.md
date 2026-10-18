# @agent-native/quality-inspection

Quality inspection capture on top of an external quality system of record. The system of record owns inspection lots, specifications and code catalogs, which arrive through the integration principal's sync command. This application owns what is recorded at the moment of inspection: results, defects and usage decisions, each forwarded to the system of record through the outbox. Records are append-only; a correction supersedes a result instead of editing it. Inspectors, supervisors and viewers hold roles per plant.

Technical documentation: [`DOCUMENTATION.md`](DOCUMENTATION.md).

Layer: content (`examples/*`). The demo quality system ([`fake-sor.ts`](fake-sor.ts)) lives here and is wired only by this application's `connect`.

## Primitives

This example is one [Application](../../docs/primitives.md#application) and the reference for the system-of-record pattern. It composes:

- a [Module](../../docs/primitives.md#module) of `inspection.*` [capabilities](../../docs/primitives.md#capability), plus the `compliance` module from its plugin;
- the `site`, `network`, `audit`, `compliance`, `process` and `driver` [host plugins](../../docs/primitives.md#host-plugin), listed in each of its three entrypoints;
- a [Driver contract](../../docs/primitives.md#driver-contract) for the capture station's measuring instrument (`contracts/instrument.ts`), and a Python [Driver process](../../docs/primitives.md#driver-process) for it in `drivers/instrument/`;
- [Outbox effects](../../docs/primitives.md#outbox-effect) for every captured record, delivered by a [Dispatcher](../../docs/primitives.md#dispatcher) through a [Connector](../../docs/primitives.md#connector), and [Inbound sync](../../docs/primitives.md#inbound-sync) of lots and code groups, all declared as one [Target](../../docs/primitives.md#target) in `contracts/target.ts`;
- [Capability bindings](../../docs/primitives.md#capability-binding) for keyboard-first capture (`useCapabilityForm`, capture timing and wedge-scan routing);
- the frame's [registry](../../docs/primitives.md#ui-registry) parts: `live-data-table`, and the operator-ui parts `tile-picker`, `numeric-pad` and `status-strip`; its Compliance screen comes from the compliance plugin.

Read the [system-of-record pattern](../../docs/system-of-record-pattern.md). `bun run generate` writes the operation reference to `dist/reference/quality-inspection/operations.md`.

## Entrypoints

| Import                                         | Runs in            | Contents                                                                                                                                 |
| ---------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/quality-inspection/manifest`    | browser and server | Default export: `defineManifest` with id `quality-inspection`.                                                                           |
| `@agent-native/quality-inspection/application` | server only        | Default export: `defineApplication`, with `connect` wiring the quality-system target and the instrument's readings.                      |
| `@agent-native/quality-inspection/screens`     | browser            | Default export: `defineScreens` with Inspection, Capture and Synchronization, the sync badge, and Compliance from the compliance plugin. |
| `@agent-native/quality-inspection/*`           | see file           | Other modules by name: `contracts` (browser-safe), `domain`, `policy`, `server`, `fake-sor`.                                             |

`contracts` composes `contracts/schemas`, `contracts/operation`, `contracts/queries` and `contracts/commands`, all browser-safe; `contracts/instrument` is the instrument's driver contract. `server` concatenates the handler groups in `handlers/`: lots, reports, capture, supervision, integration and instrument. They share `server/`, which holds the context and clock, plant and grant visibility, DTOs, and `appendResult`. That function validates a measurement, picks the sample and queues forwarding, all in the caller's transaction. Each screen in `ui/` keeps its parts in a same-named folder. Hooks that issue commands (`useCapture`, the defect and correction forms) are `.tsx`, because the UI-binding test only reads screen files.

Run it with `bun run dev` or `bun run dev:web` in this directory; port 4322. `DEMO_QUALITY_LOCKED_LOTS=<lot>,<lot>` makes the fake system reject forwarded records for those lots, as if another user held a lock, and `DEMO_QUALITY_UNAVAILABLE=1` makes every delivery fail transiently. Resolve both under **Synchronization**. The framework never reads these variables.

## Measuring instrument

The capture station can read a gauge or balance through its serial data output. The instrument only reports; its contract has no actions.

1. The inspector presses the instrument's data button. The driver reads the line and sends `measurement.taken`.
2. The application's `connect` runs `inspection.instrument.ingest` for that event as the instrument principal (`INSTRUMENT_PRINCIPAL`). The reading carries the driver's identity and the instrument's ID as reported at the handshake.
3. The capture station offers the newest unconfirmed reading above the value field. **Use reading** records it as the current sample through `inspection.result.record` with `instrumentReading`. The result keeps the reading's provenance, and the forwarded record names the instrument.

A reading is not a result until a person confirms it, because the instrument does not know which part or characteristic it measured. The authority refuses a confirmation when:

- the reading was already used;
- it is older than 10 minutes;
- it is in another unit than the characteristic;
- its value or time differs from the reading on screen.

The driver is optional. Without a site-policy binding for the `instrument-driver` process, nothing starts and the capture station looks as before. To run it, install the SDK (`sdks/driver-python`) and `pyserial` into a Python environment, and bind the process in the site policy:

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

`instrument_driver.py` documents the line format and the other settings (baud rate, framing, key or stream output). `instrument_contract.py` is generated from `contracts/instrument.ts` with the SDK's stub generator; a test fails when the two differ. `simulator.py` puts a simulated instrument on a pseudo-terminal pair for tests and demos.

## Trust boundary

Plant roles come from state, and handlers scope lots and results to the caller's plants before filtering, counting and pagination. The quality-system integration runs as its own principal (`INTEGRATION_PRINCIPAL`), whose grant can sync and settle but cannot capture. The instrument driver runs as another (`INSTRUMENT_PRINCIPAL`), which can only report readings. Readings are visible to people who capture at some plant. A commit receipt proves the local write only; the sync badge and synchronization screen show whether the system of record has accepted it. Capture telemetry measures interface economics and never influences authorization.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/integration`, `@agent-native/frame`, `@agent-native/react`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit`, `@agent-native/compliance`, `@agent-native/process`, `@agent-native/connector-driver`, and `@agent-native/testing` (tests). External: `zod`, `react`, `@tanstack/react-query`, `@tanstack/react-router`, `lucide-react`. The instrument driver needs Python 3.11 or newer and `pyserial`. Content must never import `apps/*`.

## Tests

```sh
bun test examples/quality-inspection
bun run test:sandbox
bunx playwright test examples/quality-inspection/e2e
```

| Test                       | Proves                                                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain.test.ts`           | Watermarked inbound sync, plant-scoped lists and events, one datapoint per idempotency key, all-or-nothing batches, role rules, SoR outcomes and corrections, outage behavior, metrics. |
| `test/conformance.test.ts` | A datapoint captured over any transport commits once, is forwarded once and settles live.                                                                                               |
| `test/application.test.ts` | The embedded authority syncs and drains the target it declares.                                                                                                                         |
| `test/sandbox.test.ts`     | The compiled binary with an empty environment: embedded MCP capture under a grant, drain exit codes, grant-bound `serve`.                                                               |
| `test/security.test.ts`    | Auditors read posture over HTTP; the CLI verifies, reports and detects tampering.                                                                                                       |
| `test/ui-bindings.test.ts` | Every operation that claims a UI binding is referenced by a screen.                                                                                                                     |
| `test/instrument.test.ts` | With the in-process fake driver: an event becomes a reading, an inspector confirms it once and the forwarded record names the instrument; only the instrument principal reports readings; stale, reused, mismatched and other-unit confirmations are refused; replays record once. |
| `test/instrument-driver.test.ts` | The Python driver over a pty pair with its real serial code: the committed stub matches the contract, `checkDriver` passes, a stable line becomes a confirmed result, an unplugged port fails the health check. Needs `python3` and `pyserial` (installed, or in uv's cache); skipped otherwise. |
| `e2e/inspection.pw.ts`     | Chromium: keyboard-only capture, wedge bursts and double Enter record once, live SoR outcomes, drafts keep their sample.                                                                |
| `e2e/compliance.pw.ts`     | The Compliance screen shows a new denial without reload.                                                                                                                                |
| `e2e/instrument.pw.ts` | Chromium with the real service, a site policy binding the Python driver and a pty instrument: a key press on the instrument is offered on the capture station and recorded with **Use reading**. Skipped without uv and a cached `pyserial`. |

# @agent-native/quality-inspection

`quality-inspection` captures quality inspection results on top of an external quality system, which is the [system of record](../../docs/glossary.md#system-of-record). The system of record owns inspection lots, specifications and code catalogs, which arrive through the integration principal's sync command. This application owns what is recorded at the moment of inspection: results, defects and usage decisions, each forwarded to the system of record through the [outbox](../../docs/glossary.md#outbox).

Records are append-only, and a correction supersedes a result instead of editing it. Inspectors, supervisors and viewers hold roles per plant. The example is the reference for [systems of record](../../docs/systems-of-record.md), and its measuring instrument follows [hardware drivers](../../docs/hardware-drivers.md).

## Layer

Content (`examples/*`). The demo quality system ([`fake-sor.ts`](fake-sor.ts)) lives here, and only this application's `connect` wires it.

## Primitives

The example is one [application](../../docs/primitives.md#application). It composes:

- a [module](../../docs/primitives.md#module) of `inspection.*` [capabilities](../../docs/primitives.md#capability), plus the `compliance` module from its plugin.
- the `site`, `network`, `audit`, `compliance`, `process` and `driver` (`connector-driver`) [host plugins](../../docs/primitives.md#host-plugin). The manifest and the application list them all, and the screens compose the compliance and driver plugins' screens.
- a [driver contract](../../docs/primitives.md#driver-contract) for the capture station's measuring instrument (`contracts/instrument.ts`), and a Python [driver process](../../docs/primitives.md#driver-process) for it in `drivers/instrument/`.
- [outbox effects](../../docs/primitives.md#outbox-effect) for every captured record, delivered by a [dispatcher](../../docs/primitives.md#dispatcher) through a [connector](../../docs/primitives.md#connector). [Inbound sync](../../docs/primitives.md#inbound-sync) brings in lots and code groups. One [target](../../docs/primitives.md#target) in `contracts/target.ts` declares both directions.
- [capability bindings](../../docs/primitives.md#capability-binding) for keyboard-first capture: `useCapabilityForm`, capture timing and wedge-scan routing.
- the frame's [UI registry](../../docs/primitives.md#ui-registry) parts `capability-form` and `live-data-table`. The Compliance screen comes from the compliance plugin.

`bun run generate` writes the capability reference to `dist/reference/quality-inspection/operations.md`.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/quality-inspection/manifest` | browser and server | Default export: `defineManifest` with ID `quality-inspection`. |
| `@agent-native/quality-inspection/application` | server only | Default export: `defineApplication`, whose `connect` wires the quality-system target and the instrument's readings. |
| `@agent-native/quality-inspection/screens` | browser | Default export: `defineScreens` with Inspection, Capture, Synchronization, the sync badge and the plugin screens. |
| `@agent-native/quality-inspection/*` | see file | Other modules by name: `contracts` (browser-safe), `domain`, `policy`, `server`, `fake-sor`. |

`contracts` composes `contracts/schemas`, `contracts/operation`, `contracts/queries` and `contracts/commands`, all browser-safe. `contracts/instrument` is the instrument's driver contract.

`server` concatenates the handler groups in `handlers/`: lots, reports, capture, supervision, integration and instrument. They share `server/`, which holds the context and clock, plant and grant visibility, DTOs and `appendResult`. `appendResult` validates a measurement, picks the sample and queues forwarding, all in the caller's transaction.

Each screen in `ui/` keeps its parts in a folder of the same name. Hooks that issue commands, such as `useCapture` and the defect and correction forms, are `.tsx`, because the UI-binding test only reads screen files.

### Commands

| Command (in this directory) | Purpose |
| --- | --- |
| `bun run dev` | Desktop window on port 4322 with the demo quality system. |
| `bun run dev:web` | Browser on port 4322 with the demo quality system. |

These variables change the demo quality system:

- `DEMO_QUALITY_LOCKED_LOTS=<lot>,<lot>` makes it reject forwarded records for those lots, as if another person held a lock.
- `DEMO_QUALITY_UNAVAILABLE=1` makes every delivery fail transiently.

Resolve both under **Synchronization**. The framework never reads these variables.

### Measuring instrument

The capture station can read a gauge or balance through its serial data output. The instrument only reports, and its contract has no actions.

1. The inspector presses the instrument's data button. The driver reads the line and sends `measurement.taken`.
2. The application's `connect` runs `inspection.instrument.ingest` for that event as the instrument principal (`INSTRUMENT_PRINCIPAL`). The reading carries the driver's identity and the instrument's ID as reported at the handshake.
3. The capture station offers the newest unconfirmed reading above the value field. **Use reading** records it as the current sample through `inspection.result.record` with `instrumentReading`.
4. The result keeps the reading's provenance, and the forwarded record names the instrument.

A reading is not a result until a person confirms it. The instrument does not know the part or characteristic it measured. The authority refuses a confirmation when:

- the reading was already used;
- it is older than 10 minutes;
- it is in another unit than the characteristic;
- its value or time differs from the reading on screen.

The driver is optional. Without a site-policy binding for the `instrument-driver` process, nothing starts and the capture station looks as before. To run it, install the SDK (`sdks/driver-python`) and `pyserial` into a Python environment. Then bind the process in the site policy:

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

`instrument_driver.py` documents the line format and the other settings: baud rate, framing, and key or stream output. `instrument_contract.py` is generated from `contracts/instrument.ts` with the SDK's stub generator, and a test fails when the two differ. `simulator.py` puts a simulated instrument on a pseudo-terminal pair for tests and demos.

## Trust boundary

Plant roles come from state. Handlers scope lots and results to the caller's plants before filtering, counting and pagination.

The quality-system integration runs as its own principal (`INTEGRATION_PRINCIPAL`), whose grant can sync and settle but cannot capture. The instrument driver runs as another principal (`INSTRUMENT_PRINCIPAL`), which can only report readings. Readings are visible to people who capture at some plant.

A commit [receipt](../../docs/glossary.md#receipt) proves the local write only. The sync badge and the Synchronization screen show whether the system of record has accepted it. Capture telemetry measures interface economics and does not influence authorization.

## Dependencies

Framework and plugins: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/integration`, `@agent-native/frame`, `@agent-native/react`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit`, `@agent-native/compliance`, `@agent-native/process` and `@agent-native/connector-driver`. The tests also use `@agent-native/testing`, `@agent-native/adapters`, `@agent-native/client` and `@agent-native/event-log`.

External: `zod`, `react`, `@tanstack/react-query`, `@tanstack/react-router` and `lucide-react`. The instrument driver needs Python 3.11 or newer and `pyserial`. Content must never import `apps/*`.

## Tests

```sh
bun test examples/quality-inspection
bun run test:sandbox
bunx playwright test examples/quality-inspection/e2e
```

- `domain.test.ts`:
  - watermarked inbound sync;
  - plant-scoped lists and events;
  - one datapoint per idempotency key;
  - all-or-nothing batches;
  - role rules;
  - system-of-record outcomes and corrections;
  - outage behavior;
  - metrics.
- `test/conformance.test.ts`: a datapoint captured over any surface commits once, is forwarded once and settles live.
- `test/application.test.ts`: the embedded authority syncs and drains the target it declares.
- `test/sandbox.test.ts`: the compiled binary with an empty environment runs embedded MCP capture under a grant, returns drain exit codes and runs a grant-bound `serve`.
- `test/security.test.ts`: auditors read posture over HTTP, and the CLI verifies, reports and detects tampering.
- `test/ui-bindings.test.ts`: every capability that claims a UI binding is referenced by a screen.
- `test/instrument.test.ts`, with the in-process fake driver:
  - an event becomes a reading, an inspector confirms it once, and the forwarded record names the instrument;
  - only the instrument principal reports readings;
  - stale, reused, mismatched and other-unit confirmations are refused;
  - replays record once.
- `test/instrument-driver.test.ts`, the Python driver over a pseudo-terminal pair with its real serial code:
  - the committed stub matches the contract;
  - `checkDriver` passes;
  - a stable line becomes a confirmed result;
  - an unplugged port fails the health check;
  - the test needs `python3` and `pyserial`, installed or in uv's cache, and is skipped otherwise.
- `e2e/inspection.pw.ts`, in Chromium: keyboard-only capture, wedge bursts and double Enter record once, live system-of-record outcomes, and drafts keep their sample.
- `e2e/compliance.pw.ts`: the Compliance screen shows a new denial without a reload.
- `e2e/instrument.pw.ts`, in Chromium with the real host, a site policy binding the Python driver and a pseudo-terminal instrument: a key press on the instrument is offered on the capture station and recorded with **Use reading**. It is skipped without uv and a cached `pyserial`.

## Skills

- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md) covers the target, delivery and inbound sync.
- [write-hardware-driver](../../plugins/connector-driver/skills/write-hardware-driver/SKILL.md) covers the instrument driver.
- [deploy-to-site](../../plugins/site/skills/deploy-to-site/SKILL.md) covers the site policy, starting from `site-policy.sandbox.json`.
- [build-screens](../../packages/frame/skills/build-screens/SKILL.md) covers the capture screens and registry parts.

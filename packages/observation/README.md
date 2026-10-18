# @agent-native/observation

Turns readings from sources that cannot be queried into [observations](../../docs/glossary.md#observation). A source is a vendor screen read by accessibility, OCR or a vision model, or an instrument read through a driver. The package submits observations through a domain ingest command, like any other [caller](../../docs/glossary.md#caller), and never writes storage or acts on the source.

## Layer

Framework (`packages/*`). Server only, because the observer hashes payloads with `node:crypto`. The package trusts its extractors and the application's ingest command; it treats every reading as a claim about the source.

## Primitives

- [Observation](../../docs/primitives.md#observation): readings with provenance, the stability gate and the observer.
  - `Reading`, `RawReading`, `FieldValue`: a field value with its provenance: the extractor, the frame's time and digest, and the `ModelIdentity` or `DeviceIdentity` of the model or driver that read it. A device identity records the driver ID and version, the unit's serial number and its firmware.
  - `Extractor<Frame, Field, Modality>`: the [extractor](../../docs/glossary.md#extractor) that turns one frame, such as a screen capture or a driver's state read, into raw readings. `@agent-native/screen-bridge` fixes it to screen captures and screen fields.
  - `StabilityGate` and `gateReadings`: a reading counts only once the same value arrives on `stableReads` consecutive frames. A stable reading below the field's `minConfidence` is marked `uncertain`, so the domain asks a person instead of recording it.
  - `createObserver`: samples on an interval and submits each observation through the ingest capability. Unchanged content, which excludes times and digests, is resubmitted at most once per heartbeat window.

`createStationObserver` in `@agent-native/screen-bridge` is the screen observer built on these parts. A driver connector builds the instrument observer the same way.

## Entrypoints

| Import                        | Runs in     | Contents                                                                            |
| ----------------------------- | ----------- | ----------------------------------------------------------------------------------- |
| `@agent-native/observation`   | server only | Readings, extractor type, stability gate, observer and `clampConfidence`.           |
| `@agent-native/observation/*` | server only | One source file: `readings`, `stability` or `observer`.                             |

## Trust boundary

An observer submits as the principal in its `context`. The application's policy should grant that principal the ingest capability only. Readings are claims about the source, not facts: the domain's ingest handler decides what they change. Confidence is only as good as the extractor's calibration against golden frames.

The gate filters flicker and one-off misreads. It cannot detect a source that is steadily wrong.

Each idempotency key is `observe:<source>:<fingerprint of the exact payload>`, so a retry reuses its key and different input never does. A failed submission is not remembered, so the next pass sends it again under the same key.

## Dependencies

Framework: `@agent-native/runtime`. Node: `node:crypto`.

## Tests

```sh
bun test packages/observation workstations/screen-bridge
```

- `test/observation.test.ts`: the gate with device provenance, uncertain and unknown fields, and the heartbeat and key rules.

The station suites cover the same rules through the screen observer.

## Skills

- [observe-plant-signals](skills/observe-plant-signals/SKILL.md): MQTT, Sparkplug B and OPC UA sources as readings.
- [bridge-station-screen](../../workstations/screen-bridge/skills/bridge-station-screen/SKILL.md): a workstation application reached through its screen.
- [write-hardware-driver](../../plugins/connector-driver/skills/write-hardware-driver/SKILL.md): driver contracts, SDKs and driver checks.

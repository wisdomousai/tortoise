# @agent-native/observation

Observation of sources that cannot be queried: a vendor screen read by accessibility, OCR or a vision model, or an instrument read through a driver. It turns readings into observations and submits them through a domain ingest command, like any other caller. It never writes storage and never acts on the source.

Layer: framework (`packages/*`). Server only: it hashes payloads with `node:crypto`. [Observation](../../docs/primitives.md#observation) in the primitives index.

## Contents

- `Reading`, `RawReading`, `FieldValue`: a field value with its provenance. The provenance is the extractor, the frame's time and digest, the `ModelIdentity` when a model read it and the `DeviceIdentity` when a driver did. A device identity records the driver ID and version, the unit's serial number and its firmware.
- `Extractor<Frame, Field, Modality>`: turns one frame (a screen capture, a driver's state read) into raw readings. `@agent-native/station` fixes it to screen captures and screen fields.
- `StabilityGate` and `gateReadings`: a reading counts only once the same value arrives on `stableReads` consecutive frames. A stable reading below the field's `minConfidence` is marked `uncertain`, so the domain asks a person instead of recording it.
- `createObserver`: samples on an interval and submits each observation through the ingest operation. Unchanged content, which excludes times and digests, is resubmitted at most once per heartbeat window. Each idempotency key is `observe:<source>:<fingerprint of the exact payload>`, so a retry reuses its key and different input never does.

`createStationObserver` in `@agent-native/station` is the screen observer built on these. A driver connector builds the instrument observer the same way.

## Trust boundary

An observer submits as the principal in its `context`, which the application's policy should grant the ingest operation only. Readings are claims about the source, not facts: the domain's ingest handler decides what they change, and confidence is only as good as the extractor's calibration against golden frames. The gate filters flicker and one-off misreads. It cannot detect a source that is steadily wrong.

A failed submission is not remembered, so the next pass sends it again under the same key.

## Tests

```sh
bun test packages/observation packages/station
```

`test/observation.test.ts` covers the gate with device provenance, uncertain and unknown fields, and the heartbeat and key rules. The station suites cover the same rules through the screen observer.

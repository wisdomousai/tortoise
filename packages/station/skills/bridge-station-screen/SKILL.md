---
name: bridge-station-screen
description: Bridge station software (vendor HMI, test bench, homebrew MES client) that has no API and must stay unmodified, so an application can observe it and drive declared procedures. Use when writing or changing a StationProfile, an extractor or perception source, a screen connector or observer, the golden-frame gate, or when choosing between the screen route and a driver's automation route. Covers packages/station, packages/observation and examples/line-station.
---

# Bridge a station screen

The station software is a system of record reached through its screen. A model may read the screen or propose targets; deterministic code acts and verifies. The [operator workstation pattern](../../../../docs/operator-workstation-pattern.md) explains the design, the [package README](../../README.md) lists the parts, and `examples/line-station` is the worked example.

## Before writing

- Prefer a deterministic source. If the station software has an automation interface (COM, OPC UA, a vendor export), use the automation route below instead of the screen. Accessibility comes before OCR or vision.
- List the screens, the fields, the procedures with their hazard class, and the regions no procedure may touch (emergency-stop reset, interlock override, manual jog).
- The bridge never operates safety functions, and this is not a safety-rated system.

## Steps

1. **Model the target.** Commands record desired state and enqueue an effect on target `legacy-hmi:<station>`. The screen connector (`createStationConnector`) is the outbox port; readback of the desired value is acceptance. Its delivery uses the convergent delivery in `packages/integration` (the `connect-system-of-record` skill, `packages/integration/skills/connect-system-of-record/SKILL.md`).
2. **Report what the screen shows** through an observer (`createStationObserver`) that submits an ingest command under `station-bridge:<station>`. Keep provenance (extractor, model, confidence, frame digest). An uncertain reading becomes an attention item for a person, never a silent value.
3. **Put site particulars in a versioned `StationProfile`** (`examples/line-station/station-profile.json`): screens by anchors, fields, forbidden regions, procedures with preconditions, readback, hazard class and rerun safety. `validateProfile` rejects steps that target forbidden regions or unknown fields.
4. **Gate actuation.** Default to `monitor-only`. Starting procedures that need a person, reconciling held effects and taking over the screen are person-only commands; deny them to agent runs and grants. Never give the computer-use agent catalog write tools beyond ingest and settle under its own integration principal.
5. **Choose an extractor**: `createAccessibilityExtractor`, `createWorkerExtractor` (a JSON-lines worker started through the process port), `createOpenAiCompatibleVisionExtractor` on loopback, or `createFixtureExtractor` for CI.
6. **Build the station screen** from the operator registry (`packages/operator-ui`; see the `build-screens` skill, `packages/frame/skills/build-screens/SKILL.md`) and scanners from `packages/devices` (the `add-scanner-input` skill, `packages/devices/skills/add-scanner-input/SKILL.md`).
7. **Shared seats.** Where operators share a station, compose `plugins/station-sign-in` so each operator signs in by badge and PIN and acts with their own authority.

## Automation route

A station whose software has an automation interface is reached through a driver instead of its screen. The driver's contract carries the same fields and procedures, with the same preconditions, readback and hazard classes, and its bridge runs as the same station principal with the same grant and target. Handlers, contracts and screens do not change with the route. Its `control` field replaces the screen's local input check. `examples/line-station` configures each station on one route; its C# driver reaches a COM server (`examples/line-station/drivers/automation`). Write the driver with the `write-hardware-driver` skill (`plugins/connector-driver/skills/write-hardware-driver/SKILL.md`) and read [hardware drivers](../../../../docs/hardware-drivers.md#examples).

## Checks

- Gate every profile or perception change with the golden-frame check on labeled frames: `cd examples/line-station && bun run station:golden` (`scripts/station-golden.ts`). Without a configured model it replays recorded expectations and checks only the wiring. The example's `station:record-golden` script re-records frames from the fake HMI.
- Add a composed conformance test (surface parity, lane separation) and a browser test against a separate fake HMI process (`examples/line-station/e2e/station.pw.ts`).

```sh
bun test packages/station packages/observation
bun test examples/line-station
bunx playwright test examples/line-station/e2e
```

Report deterministic, browser, device and live-model evidence separately, in the [implementation status](../../../../docs/implementation-status.md#operator-workstation-bridge). None of them implies a live computer-use driver or real hardware.

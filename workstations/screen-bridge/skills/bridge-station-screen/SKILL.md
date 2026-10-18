---
name: bridge-station-screen
description: Bridge a workstation application (vendor HMI, test-bench software, MES client) that has no API and must stay unmodified, so an application can observe it and drive declared procedures. Use when writing or changing a StationProfile, an extractor, a screen connector or the golden-frame gate, or when choosing the screen route or a driver. Covers workstations/screen-bridge, packages/observation and examples/line-station.
---

# Bridge a workstation application through its screen

A [workstation application](../../../../docs/glossary.md#workstation-application) that has no API is a [system of record](../../../../docs/glossary.md#system-of-record) the application reaches through its screen. A model may read the screen or propose an on-screen target; deterministic code acts and verifies. [Operator workstations](../../../../docs/operator-workstations.md) explains the design, the [package README](../../README.md) lists the parts, and `examples/line-station` is the worked example.

## Before writing

- Prefer a deterministic source. When the workstation application has an automation interface, such as COM, OPC UA or a vendor export, follow the automation route below instead of the screen.
- Among screen sources, prefer accessibility to OCR or vision.
- List the screens, the fields and the [procedures](../../../../docs/glossary.md#procedure) with their [hazard class](../../../../docs/glossary.md#hazard-class).
- List the regions no procedure may touch: emergency-stop reset, interlock override, manual jog.
- The bridge never operates safety functions. It is not a safety-rated system.

## Steps

### Screen route

1. Make each command record the desired state and enqueue an outbox [effect](../../../../docs/glossary.md#effect) on the target `legacy-hmi:<station>`.
2. Deliver those effects with the screen connector, `createStationConnector`, which implements the system-of-record port. It uses the convergent delivery in `packages/integration`, so a readback of the desired value is acceptance. The `connect-system-of-record` skill (`packages/integration/skills/connect-system-of-record/SKILL.md`) covers that side.
3. Report what the screen shows through an observer, `createStationObserver`, that submits an ingest command under `station-bridge:<station>`.
4. Keep each reading's provenance: extractor, model, confidence and frame digest.
5. Turn an uncertain reading into an attention item for a person. It never becomes a silent value.
6. Put the site particulars in a versioned [station profile](../../../../docs/glossary.md#station-profile), `StationProfile`, as in `examples/line-station/station-profile.json`. It holds screens by anchors, fields, forbidden regions, and procedures with preconditions, readback, hazard class and rerun safety. `validateProfile` rejects steps that target forbidden regions or unknown fields.
7. Set the [bridge mode](../../../../docs/glossary.md#bridge-mode) to `monitor-only` by default.
8. Make starting procedures that need a person, reconciling held effects and taking over the screen person-only commands. Deny them to agent runs and grants.
9. Give the computer-use agent no catalog write tools beyond ingest and settle, under its own [integration principal](../../../../docs/glossary.md#integration-principal).
10. Choose an [extractor](../../../../docs/glossary.md#extractor):
    - `createAccessibilityExtractor`;
    - `createWorkerExtractor`, a JSON-lines worker started through the process port;
    - `createOpenAiCompatibleVisionExtractor` on loopback;
    - `createFixtureExtractor` for CI.
11. Build the workstation's screen from the operator registry in `packages/operator-ui`, following the `build-screens` skill (`packages/frame/skills/build-screens/SKILL.md`).
12. Add scanners from `packages/devices` with the `add-scanner-input` skill (`packages/devices/skills/add-scanner-input/SKILL.md`).
13. Where operators share a workstation, compose `workstations/sign-in`. Each operator then signs in by badge and PIN and acts as their own [principal](../../../../docs/glossary.md#principal).

### Automation route

A station whose software has an automation interface is reached through a [driver](../../../../docs/glossary.md#driver) instead of its screen. Handlers, contracts and screens stay the same on either route. [Operator workstations](../../../../docs/operator-workstations.md#automation-route) explains the route.

1. Give the driver's contract the same fields and procedures, with the same preconditions, readback and hazard classes.
2. Run its bridge as the same station principal, with the same grant and target.
3. Use the contract's `control` field in place of the screen's local input check.
4. Configure each station on one route, as `examples/line-station` does. Its C# driver reaches a COM server (`examples/line-station/drivers/automation`).
5. Write the driver with the `write-hardware-driver` skill (`plugins/connector-driver/skills/write-hardware-driver/SKILL.md`), and read the [hardware drivers examples](../../../../docs/hardware-drivers.md#examples).

## Checks

1. Gate every profile or perception change with the [golden check](../../../../docs/glossary.md#golden-check) on labeled frames: `cd examples/line-station && bun run station:golden` (`scripts/station-golden.ts`). Without a configured model it replays recorded expectations and checks only the wiring.
2. Re-record frames from the fake HMI with the example's `station:record-golden` script.
3. Add a composed conformance test for surface parity and lane separation.
4. Add a browser test against a separate fake HMI process (`examples/line-station/e2e/station.pw.ts`).
5. Run the tests:

```sh
bun test workstations/screen-bridge packages/observation
bun test examples/line-station
bunx playwright test examples/line-station/e2e
```

Report deterministic, browser, device and live-model evidence separately in [implementation status](../../../../docs/implementation-status.md#operator-workstation-bridge). None of them implies a live computer-use driver or real hardware.

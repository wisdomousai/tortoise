---
name: bridge-station-screen
description: Connect a workstation application through its screen. Use when defining a station profile or extractor, composing observed input and procedure delivery, or checking a profile against labeled frames.
---

# Bridge a workstation application through its screen

A screen bridge observes a workstation application through declared extractors. Its connector executes the procedures in a station profile and checks the required readback. The profile defines the interaction permitted with that workstation.

## Before writing

- When the workstation application has an automation interface, such as COM, OPC UA or a vendor export, follow the automation route below instead of the screen.
- Among screen sources, prefer accessibility to OCR or vision.
- List the screens, the fields and the procedures with their risk level.
- List the regions no procedure may touch: emergency-stop reset, interlock override, manual jog.
- The bridge never operates safety functions. It is not a safety-rated system.

## Steps

### Screen route

1. Make a command that requests a workstation change record its desired state and enqueue an effect on the station's declared target.
2. Deliver those effects with the screen connector, `createStationConnector`, which implements the system-of-record port. It uses the convergent delivery in `packages/integration`, so a readback of the desired value is acceptance. The `connect-system-of-record` skill (`packages/integration/skills/connect-system-of-record/SKILL.md`) covers that side.
3. Use `createStationObserver` to submit screen observations through an ingest command under a narrowly scoped integration principal.
4. Keep each reading's provenance: extractor, model, confidence and frame digest.
5. Turn an uncertain reading into an attention item for a person. It never becomes a silent value.
6. Put the station particulars in a versioned station profile, `StationProfile`. It lists screens by anchors, fields, forbidden regions, and procedures with preconditions, readback, risk level and rerun safety. `validateProfile` rejects steps that target forbidden regions or unknown fields.
7. Set the bridge mode to `monitor-only` by default.
8. Make starting procedures that need a person, reconciling held effects and taking over the screen person-only commands. Deny them to agent runs and grants.
9. Give the computer-use agent no catalog write tools beyond ingest and complete, under its own integration principal.
10. Choose an extractor:
    - `createAccessibilityExtractor`;
    - `createWorkerExtractor`, a JSON-lines worker started through the process port;
    - `createOpenAiCompatibleVisionExtractor` on loopback;
    - `createFixtureExtractor` for CI.
11. Build the workstation's screen from the operator registry in `packages/operator-ui`, following the `build-screens` skill (`packages/frame/skills/build-screens/SKILL.md`).
12. Add scanners from `packages/devices` with the `add-scanner-input` skill (`packages/devices/skills/add-scanner-input/SKILL.md`).
13. Where operators share a workstation, compose `workstations/sign-in` with the `sign-in-at-a-terminal` skill (`workstations/sign-in/skills/sign-in-at-a-terminal/SKILL.md`). Each operator then signs in by badge and PIN and acts as their own principal.

### Automation route

Use a driver for an available automation interface. Review its observation and action contracts before changing the connection. Existing application operations can remain when the new interface preserves their declared behavior.

1. Give the driver's contract the same fields and procedures, with the same preconditions, readback and risk levels.
2. Run its bridge as the same station principal, with the same grant and target.
3. Use the contract's `control` field in place of the screen's local input check.
4. Configure the selected route for each station and verify its ownership and readback behavior.
5. Write the driver with the `write-hardware-driver` skill (`plugins/connector-driver/skills/write-hardware-driver/SKILL.md`), and read the [driver contract](../../../../docs/hardware-drivers.md#driver-contract).

## Checks

1. Gate every profile or recognition change with the golden test on labeled frames: `cd showcase/examples/winding-line && bun run station:golden` (`scripts/station-golden.ts`). Without a configured model it replays recorded expectations and checks only the wiring.
2. Re-record frames from the fake HMI with the example's `station:record-golden` script.
3. Add a composed conformance test for channel parity and for each principal calling only its own operations.
4. Add a browser test against a separate fake HMI process (`showcase/examples/winding-line/e2e/station.pw.ts`).
5. Run the tests:

```sh
bun test workstations/screen-bridge packages/observation
bun test showcase/examples/winding-line
bunx playwright test showcase/examples/winding-line/e2e
```

Report deterministic, browser, device and live-model evidence separately in [implementation status](../../../../docs/implementation-status.md#operator-workstation-bridge).

## References

- [Operator workstations](../../../../docs/operator-workstations.md)
- [`@tortoise/screen-bridge`](../../README.md)
- [Operator workstations](../../../../docs/operator-workstations.md#automation-route)

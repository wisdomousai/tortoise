# Bridge a screen-only station

Use this when station software (vendor HMI, test bench, homebrew MES client) has no API and must stay unmodified. Read `docs/operator-workstation-pattern.md`, ADR 004 and `docs/point-of-work-input.md` in the target checkout; `examples/line-station` is the worked example.

- Model the station software as a system of record reached through its screen. Commands record desired state and enqueue an effect on target `legacy-hmi:<station>`; the screen connector (`createStationConnector`) is the outbox port. Readback of the desired value is acceptance. Never give the computer-use agent catalog write tools beyond ingest and settle under its own integration principal.
- Report what the screen shows through an observer (`createStationObserver`) that submits an ingest command under `station-bridge:<station>`. Keep provenance (extractor, model, confidence, frame digest); uncertain readings become attention items for a person, never silent values.
- Put site particulars in a versioned `StationProfile`: screens, fields, forbidden regions (e-stop reset, interlock override, jog), procedures with hazard class, preconditions, readback and rerun safety. Validation rejects steps that target forbidden regions.
- Default to `monitor-only`. Make starting procedures that need a person, reconciling held effects and taking over the screen person-only commands; deny agent runs and grants.
- Prefer deterministic sources: vendor export or accessibility before OCR or vision. Local models plug in through the JSON-lines worker or an OpenAI-compatible endpoint on loopback; gate profile and model changes with `scripts/station-golden.ts` on labeled frames.
- Build the station screen from the `operator` registry (`packages/operator-ui`) and scanners from `packages/devices`; compose `deviceConfigModule` for per-station scanner profiles.
- Add a composed conformance test (surface parity, lane separation) and a browser test against a separate fake HMI process. Report deterministic, browser, device and live-model evidence separately; no live computer-use driver or hardware is implied by them.

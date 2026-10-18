# @agent-native/station

A bridge to legacy station software that can only be read and driven through its screen. Observations enter the application through a domain ingest command (`createStationObserver`). Actions leave through the outbox as a system-of-record connector (`createStationConnector`), where a gated controller runs declared procedures and accepts them only on stable readback. A model may read the screen or propose targets; deterministic code acts and verifies. Nothing here writes application state directly.

Layer: framework (`packages/*`). Server only, except `requirements`. Domain-neutral: the station screen and the outbox targets are declared by the domain module, for example `examples/line-station`.

## Primitives

- [Observation](../../docs/primitives.md#observation): `createStationObserver`, `stationBridgeComponent`. The readings, the stability gate and the observer loop come from `@agent-native/observation`; `StabilityGate`, `Reading`, `ModelIdentity` and the other reading types are re-exported, and `Extractor` is its extractor over screen captures.
- [Gated actuator](../../docs/primitives.md#gated-actuator): `ComputerUseDriver`, `ScreenTransport`, `BridgeControl`, `createScriptedDriver`, `createPlaywrightTransport`. The controller's delivery order, stable confirmation, interruption rule and lookup come from the convergent delivery in `@agent-native/integration`; the screen gate (bridge mode, seat, expected screen, forbidden regions, step budget) stays here.
- [Connector](../../docs/primitives.md#connector): `createStationConnector` implements the system-of-record port for a screen.
- [Profile](../../docs/primitives.md#profile): `StationProfile`, `stationProfileSchema`, `validateProfile`, `parseProfile`.
- [Golden check](../../docs/primitives.md#golden-check): `runGolden`, `GoldenReport`.

The [operator workstation pattern](../../docs/operator-workstations.md) explains the design.

## Entrypoints

| Import                               | Runs in            | Contents                                                                                                      |
| ------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `@agent-native/station`              | server only        | Ports, profiles, perception, observer, connector, scripted driver, golden check, extractors and transport.    |
| `@agent-native/station/*`            | see below          | One source file, for example `@agent-native/station/perception/worker`.                                       |
| `@agent-native/station/requirements` | browser and server | `stationBridgeComponent`: vision endpoints and the perception worker as declared requirements. Loads nothing. |

`controller` and `profile` compose parts that are imported only from inside the package. `src/controller/` holds the shared kernel (perception, clock and this process's attempt memory, over the integration package's convergent reads), the safety gate (bridge state and forbidden zones), payload and precondition checks before delivery, the step runner with its per-action guard, and lookup. `src/profile/` holds `$input` bindings, region geometry and profile validation; `profile` re-exports them, so existing imports are unchanged.

Extractors: `createAccessibilityExtractor` (accessibility tree), `createWorkerExtractor` (a JSON-lines worker process for OCR, classifiers or local models; it receives a `start` that returns a `WorkerProcess`, so the host's process port, not this package, starts it), `createOpenAiCompatibleVisionExtractor` (a local OpenAI-compatible vision endpoint) and `createFixtureExtractor` (replays recorded readings in CI). The Playwright transport is typed structurally, so this package does not depend on Playwright.

## Trust boundary

The bridge reaches station software only through its ports. Each reading carries its source, model identity and digest, frame digest, time and confidence, and becomes current only after it is stable across consecutive reads. A low-confidence reading is submitted as uncertain, for a person to confirm. Unchanged content is resubmitted at most once per heartbeat window, and each submission's idempotency key fingerprints its exact payload.

The controller performs every action itself after a gate covering the expected screen (checked before every click, type and key), forbidden regions, the allowed set, step budget, timeout, bridge mode (`monitor-only`, `assist`, `actuate`) and seat. Local input at the station stops a procedure; an operator takeover holds the effect for reconciliation. Acceptance needs matching readback on as many consecutive views as the fields' `stableReads` declare. An interrupted procedure that is not declared rerunnable is held, never re-run.

Vision endpoints must be loopback or explicitly allowlisted and never follow a redirect, so screenshots reach only the validated host. Model output is untrusted and schema-validated; confidence is agreement across reads, not the model's claim. The perception worker starts with an empty environment and is restarted with a fresh handshake if it exits. `perception/worker.ts` and `perception/openai-compatible-vision.ts` are reviewed egress exemptions in `scripts/boundary-rules.ts`.

Gaps: observation covers screens only; no live computer-use model driver; no VNC, RDP, KVM or UI Automation transport; activation does not require a passing golden report.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/integration`. External: `zod`.

## Tests

```sh
bun test packages/station
cd examples/line-station && bun run station:golden
```

- `test/controller.test.ts`: per-action screen gate, stable readback, popups and local input stop procedures, uncertain procedures held.
- `test/observer.test.ts`: only stable readings become current; unsure readings stay uncertain.
- `test/perception.test.ts`: vision endpoints are loopback or allowlisted; also worker restart, redirects and golden gating.
- `test/profile.test.ts`: procedures cannot target forbidden regions or unknown fields.

## Skills

- [bridge-station-screen](skills/bridge-station-screen/SKILL.md): Bridge station software through its screen, or choose its automation route instead.

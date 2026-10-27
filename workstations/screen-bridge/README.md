# @agent-native/screen-bridge

The [screen bridge](../../docs/glossary.md#screen-bridge) reads a [workstation application](../../docs/glossary.md#workstation-application) and drives it through its screen. [Observations](../../docs/glossary.md#observation) enter the application through a domain ingest command (`createStationObserver`). Actions leave through the [outbox](../../docs/glossary.md#outbox) as a [system-of-record](../../docs/glossary.md#system-of-record) [connector](../../docs/glossary.md#connector) (`createStationConnector`). Inside the connector, a gated controller runs declared [procedures](../../docs/glossary.md#procedure) and accepts them only on stable readback.

## Layer

Workstation (`workstations/*`). Server only, except `requirements`. The domain [module](../../docs/glossary.md#module) declares the screen and the outbox targets, as `showcase/examples/winding-line` does. The package trusts the host's ports and treats model output as untrusted. A model may read the screen or suggest targets; deterministic code acts and verifies. Nothing here writes application state directly.

## Primitives

- [Observation](../../docs/primitives.md#observation): `createStationObserver`, `stationBridgeComponent`. The readings, the stability gate and the observer loop come from `@agent-native/observation`. `StabilityGate`, `Reading`, `ModelIdentity` and the other reading types are re-exported, and `Extractor` is its [extractor](../../docs/glossary.md#extractor) over screen captures.
- [Gated actuator](../../docs/primitives.md#gated-actuator): `ComputerUseDriver`, `ScreenTransport`, `BridgeControl`, `createScriptedDriver`, `createPlaywrightTransport`.
  - The controller's delivery order, stable confirmation, interruption rule and lookup come from the convergent delivery in `@agent-native/integration`.
  - The screen gate stays here: bridge mode, [seat](../../docs/glossary.md#seat), expected screen, forbidden regions and step budget.
- [Connector](../../docs/primitives.md#connector): `createStationConnector` implements the system-of-record port for a screen.
- [Station profile](../../docs/primitives.md#station-and-scanner-profiles): `StationProfile`, `stationProfileSchema`, `validateProfile`, `parseProfile`.
- [Golden check](../../docs/primitives.md#golden-check): `runGolden`, `GoldenReport`.

## Entrypoints

| Import                               | Runs in            | Contents                                                                                                   |
| ------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `@agent-native/screen-bridge`              | server only        | Ports, profiles, perception, observer, connector, scripted driver, golden check, extractors and transport. |
| `@agent-native/screen-bridge/*`            | see below          | One source file, such as `@agent-native/screen-bridge/perception/worker`.                                        |
| `@agent-native/screen-bridge/requirements` | browser and server | `stationBridgeComponent`: vision endpoints and the perception worker as declared requirements. Loads nothing. |

`controller` and `profile` compose parts that are imported only from inside the package.

The [perception sources](../../docs/glossary.md#perception-source) are these extractors:

- `createAccessibilityExtractor`: the accessibility tree.
- `createWorkerExtractor`: a JSON-lines worker process for OCR, classifiers or local models. It receives a `start` that returns a `WorkerProcess`, so the host's process port starts the worker, not this package.
- `createOpenAiCompatibleVisionExtractor`: a local OpenAI-compatible vision endpoint.
- `createFixtureExtractor`: replays recorded readings in CI.

The Playwright transport is typed structurally, so this package does not depend on Playwright.

## Trust boundary

### Readings

The screen bridge reaches the workstation application only through its ports. Each reading carries its source, model identity and digest, frame digest, time and confidence. A reading becomes current only after it is stable across consecutive reads. A low-confidence reading is submitted as `uncertain`, for a person to confirm. Unchanged content is resubmitted at most once per heartbeat window. Each submission's idempotency key fingerprints its exact payload.

### Controller gate

The controller performs every action itself, after a gate that covers:

- the expected screen, checked before every click, type and key;
- forbidden regions, the allowed set, step budget and timeout;
- the [bridge mode](../../docs/glossary.md#bridge-mode): `monitor-only`, `assist` or `actuate`;
- the seat.

Local input at the station stops a procedure. An operator takeover holds the effect for [reconciliation](../../docs/glossary.md#reconciliation). Acceptance needs matching readback on as many consecutive views as the fields' `stableReads` declare. An interrupted procedure that is not declared rerunnable is held and not run again.

### Perception

Vision endpoints must be loopback or explicitly allowlisted, and requests do not follow a redirect. Screenshots therefore reach only the validated host. Model output is untrusted and schema-validated. Confidence is agreement across reads, not the model's claim.

The process plugin builds the perception worker's environment. A worker that exits is restarted with a fresh handshake. `perception/openai-compatible-vision.ts` is a reviewed egress exemption in `scripts/boundary-rules.ts`, because it falls back to global `fetch` when none is injected.

### Gaps

- Observation covers screens only.
- No live computer-use model driver exists.
- No VNC, RDP, KVM or UI Automation transport exists.
- Activation does not require a passing golden report.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/integration`, `@agent-native/observation`. External: `zod`.

## Tests

```sh
bun test workstations/screen-bridge
cd showcase/examples/winding-line && bun run station:golden
```

- `test/controller.test.ts`: per-action screen gate and stable readback; popups and local input stop procedures; procedures with an unknown outcome are held.
- `test/observer.test.ts`: only stable readings become current; unsure readings stay `uncertain`.
- `test/perception.test.ts`: vision endpoints are loopback or allowlisted; worker restart, redirects and golden gating.
- `test/profile.test.ts`: procedures cannot target forbidden regions or unknown fields.

## Skills

- [bridge-station-screen](skills/bridge-station-screen/SKILL.md): Bridge workstation application through its screen, or choose its automation route instead.

## References

- [Operator workstations](../../docs/operator-workstations.md)

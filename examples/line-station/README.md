# @agent-native/line-station

Operator workstations on a production line, where the machine software can only be read and driven through its screen, on top of a homebrew MES that owns orders and stop reasons. The station software owns machine state, the loaded recipe and counters; this application observes them through a station bridge, with provenance. It owns what happens at the station: stops and their classification, count confirmations, operator verifications, the desired recipe, the bridge mode and the seat. Records forwarded to the MES and recipe loads on the screen leave through the outbox.

Layer: content (`examples/*`). The fake MES ([`fake-mes.ts`](fake-mes.ts)) and the fake HMI ([`fake-hmi/`](fake-hmi/simulator.ts)) are demo and test fixtures that live here only.

## Primitives

This example is one [Application](../../docs/primitives.md#application) and the reference for the operator-workstation pattern. It composes:

- a [Module](../../docs/primitives.md#module) of `line.*` [capabilities](../../docs/primitives.md#capability), plus the device [Configuration module](../../docs/primitives.md#configuration-module) and the `compliance` module from its plugin;
- the `site`, `network`, `audit`, `compliance` and `automation` [host plugins](../../docs/primitives.md#host-plugin), listed in each of its three entrypoints. `automation.ts` declares the `expire-proposals` [Trigger](../../docs/primitives.md#trigger), which a supervisor enables with a [Standing grant](../../docs/primitives.md#standing-grant) and which then closes expired proposals at their stations every five minutes;
- the station bridge: [Observation](../../docs/primitives.md#observation) submitted through `line.observation.ingest`, and a [Gated actuator](../../docs/primitives.md#gated-actuator) behind a station-screen [Connector](../../docs/primitives.md#connector), configured by a station [Profile](../../docs/primitives.md#profile) ([`station-profile.json`](station-profile.json)) and gated by a [Golden check](../../docs/primitives.md#golden-check);
- MES delivery through [Outbox effects](../../docs/primitives.md#outbox-effect), a [Dispatcher](../../docs/primitives.md#dispatcher) and [Inbound sync](../../docs/primitives.md#inbound-sync), declared as a [Target](../../docs/primitives.md#target) in `contracts/target.ts`. Station bridges settle their screen procedures through the same settle operation, so its handler overrides which effects a principal may settle;
- the `stop.explainer` [Agent definition](../../docs/primitives.md#agent-definition), which proposes a stop reason as a [Proposal](../../docs/primitives.md#proposal) about `stop:<id>`. The station shows it as an attention tile, and accepting classifies the stop as the operator. Proposals take the station of the stop they are about, so the policy resolves it for submit, accept and reject;
- [Input sources](../../docs/primitives.md#input-source) and the operator [UI registry](../../docs/primitives.md#ui-registry) on a glove-sized station surface.

Read the [operator workstation pattern](../../docs/operator-workstation-pattern.md) and [point-of-work input](../../docs/point-of-work-input.md). The generated [operation reference](../../docs/reference/line-station/operations.md) lists every operation.

## Entrypoints

| Import                                   | Runs in            | Contents                                                                                                                                                        |
| ---------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/line-station/manifest`    | browser and server | Default export: `defineManifest` with id `line-station`, its modules and the station-bridge component.                                                          |
| `@agent-native/line-station/application` | server only        | Default export: `defineApplication`, with `connect` wiring the MES and, when configured, the station bridge.                                                    |
| `@agent-native/line-station/screens`     | browser            | Default export: `defineScreens` with stations, the station surface, device setup, the bridge view, the operator kit, and Compliance from the compliance plugin. |
| `@agent-native/line-station/*`           | see file           | Other modules by name: `contracts` (browser-safe), `domain`, `policy`, `server`, `bridge`, `station-bridge`, `fake-mes`.                                        |

`contracts` composes `contracts/schemas`, `contracts/operation` (descriptions and the capability helper), `contracts/queries` and `contracts/commands`, which are browser-safe like it. `server` concatenates one handler group per concern from `handlers/` (queries, production, attention, administration, observation, integration). Those groups share `server/`: the handler context and clock, station access, DTOs, attention items and outcome settlement. Every handler checks state and authorization inside its own command, exactly as before the split.

`ui/station` re-exports the station screens from `ui/station/`: the overview, MES status, and the station surface with one part per region (header, machine banner, stop reasons, correction, counters, order task, recent stops, requested recipe). `StationSurface` keeps the command in flight and the open correction, via `useStationCommands` and `useAttention`, so live updates do not reset them. Files that issue commands are `.tsx`, because the UI-binding test only reads screen files. `ui/station-kit/` holds the gallery's demo state. The gallery screen owns that state because the inactive tab unmounts.

| Command (in this directory)       | Purpose                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `bun run dev` / `bun run dev:web` | Desktop window or browser on port 4323, with the fake HMI started in-process and bridged.      |
| `bun run dev:hmi`                 | The fake HMI alone on port 4610, with simulation endpoints.                                    |
| `bun run station:golden`          | Station profile and perception gate on the labeled frames in `golden/`.                        |
| `bun run station:record-golden`   | Re-record golden frames from the fake HMI in Chromium after changing the simulator or profile. |

The bridge starts only when `STATION_HMI_URL` is set; nothing is discovered. Counters on the fake HMI are pixel-only, so they need `STATION_SIMULATOR=1`, a local vision model (`STATION_VISION_BASE_URL`, `STATION_VISION_MODEL`, `STATION_VISION_ALLOWED_HOSTS`, `STATION_VISION_READS`) or a perception worker (`STATION_PERCEPTION_WORKER`). `STATION_ID`, `STATION_PROFILE` and `STATION_OBSERVE_MS` select the station, profile and interval. [Development and testing](../../docs/development-and-testing.md#station-bridge-demo-and-opt-in-perception) has the full table.

## Trust boundary

Three kinds of principal touch this module. People hold operator, supervisor or viewer roles per station. Each station's bridge (`station-bridge:<station>`) may only submit what the screen shows and settle screen procedures. The MES integration (`MES_PRINCIPAL`) may only sync orders and reasons and settle forwarded records; its grant cannot reach station screens, observations or any person's command. Neither integration principal can act as a person.

The bridge acts only in the mode the station sets (`monitor-only`, `assist`, `actuate`) and only while it holds the seat; an operator takes over with one tap. Unsure counter reads become attention items for a person instead of facts. The MES is non-idempotent, so forwarded stops are delivered exactly once by lookup. `station-bridge.ts` and `fake-hmi/` are reviewed egress exemptions in `scripts/boundary-rules.ts`.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/integration`, `@agent-native/station`, `@agent-native/devices`, `@agent-native/frame`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit`, `@agent-native/assurance`, and `@agent-native/testing` (tests). Operator parts come from `@agent-native/operator-ui` through the `@/` alias. External: `zod`, `react`, `@tanstack/react-query`, `@tanstack/react-router`, `lucide-react`; `@playwright/test` drives the HMI's browser screen. Content must never import `apps/*`.

## Tests

```sh
bun test examples/line-station
bunx playwright test examples/line-station/e2e
```

| Test                       | Proves                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `domain.test.ts`           | Observations with provenance, exactly-once MES forwarding, recipe loads accepted by readback, monitor-only and seat holds, popups and takeover held for reconciliation, unsure reads asking a person, principals staying in their lane.                                                                                  |
| `test/conformance.test.ts` | A station observed through its screen reads the same on every transport; lanes stay separate.                                                                                                                                                                                                                            |
| `test/application.test.ts` | Idempotent state upgrade; a station is bridged only when named; drain reports station targets it cannot deliver.                                                                                                                                                                                                         |
| `golden.test.ts`           | The recorded golden frames pass the station profile gate.                                                                                                                                                                                                                                                                |
| `test/proposals.test.ts`   | The stop explainer proposes and cannot classify; a viewer and the run cannot accept; an operator's acceptance classifies as the operator; proposals stay at their station; a stale stop conflicts and a demoted operator is refused; the expiry job closes only expired proposals at the stations of whoever enabled it. |
| `test/ui-bindings.test.ts` | Every operation that claims a UI binding is referenced by a screen.                                                                                                                                                                                                                                                      |
| `e2e/station.pw.ts`        | Chromium: hold-to-confirm, tile hotkeys versus wedge scans, keypad tolerance, takeover, and a stop observed on the fake HMI classified end to end.                                                                                                                                                                       |

The deterministic golden gate replays recorded expectations, which checks wiring only. A live vision-model gate is a separate result; record it separately in the [implementation status](../../docs/implementation-status.md).

# @agent-native/line-station

`line-station` runs operator workstations on a production line, where the machine software can only be read and driven through its [station screen](../../docs/glossary.md#screen). A homebrew MES owns orders and stop reasons. The station software owns machine state, the loaded recipe and counters, and this application observes them through a station bridge, with provenance.

The application owns what happens at the station:

- stops and their classification;
- count confirmations;
- operator verifications;
- the desired recipe, the bridge mode and the [seat](../../docs/glossary.md#seat).

Records forwarded to the MES and recipe loads on the screen leave through the [outbox](../../docs/glossary.md#outbox). The example is the reference for [operator workstations](../../docs/operator-workstations.md) and uses [point-of-work input](../../docs/point-of-work-input.md).

## Layer

Content (`examples/*`). The fake MES ([`fake-mes.ts`](fake-mes.ts)) and the fake HMI ([`fake-hmi/`](fake-hmi/simulator.ts)) are demo and test fixtures that live here only.

## Primitives

The example is one [application](../../docs/primitives.md#application). It composes:

- a [module](../../docs/primitives.md#module) of `line.*` [capabilities](../../docs/primitives.md#capability), the [device configuration module](../../docs/primitives.md#device-configuration-module), and the `compliance` module from its plugin.
- the `site`, `network`, `process`, `audit`, `compliance`, `automation` and `connector-driver` [host plugins](../../docs/primitives.md#host-plugin), listed in the manifest and the application. The screens compose the compliance, automation and driver plugins' screens.
- the `expire-proposals` [trigger](../../docs/primitives.md#trigger), declared in `automation.ts`. A supervisor enables it with a [standing grant](../../docs/primitives.md#standing-grant), and it then closes expired proposals at their stations every five minutes.
- the station bridge. [Observations](../../docs/primitives.md#observation) are submitted through `line.observation.ingest`. A [gated actuator](../../docs/primitives.md#gated-actuator) sits behind a station-screen [connector](../../docs/primitives.md#connector), configured by a [station profile](../../docs/primitives.md#station-and-scanner-profiles) ([`station-profile.json`](station-profile.json)) and gated by a [golden check](../../docs/primitives.md#golden-check).
- MES delivery through [outbox effects](../../docs/primitives.md#outbox-effect), a [dispatcher](../../docs/primitives.md#dispatcher) and [inbound sync](../../docs/primitives.md#inbound-sync), declared as a [target](../../docs/primitives.md#target) in `contracts/target.ts`. Station bridges settle their screen procedures through the same settle command, so its handler overrides which effects a principal may settle.
- the `stop.explainer` [agent definition](../../docs/primitives.md#agent-definition), which proposes a stop reason as a [proposal](../../docs/primitives.md#proposal) about `stop:<id>`. The station shows it as an attention tile, and accepting it classifies the stop as the operator. A proposal takes the station of the stop it is about, so the policy resolves that station for submit, accept and reject.
- the automation route: a [driver contract](../../docs/primitives.md#driver-contract) for the station software's automation interface (`contracts/automation.ts`), the driver bridge (`driver-bridge.ts`) and a .NET [driver process](../../docs/primitives.md#driver-process) in `drivers/automation/`. [Automation route](#automation-route) describes it.
- [input sources](../../docs/primitives.md#input-source) and the operator [UI registry](../../docs/primitives.md#ui-registry) on a glove-sized station surface.

`bun run generate` writes the capability reference to `dist/reference/line-station/operations.md`.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/line-station/manifest` | browser and server | Default export: `defineManifest` with ID `line-station`, its modules and the station-bridge component. |
| `@agent-native/line-station/application` | server only | Default export: `defineApplication`, whose `connect` wires the MES and, when configured, one station route. |
| `@agent-native/line-station/screens` | browser | Default export: `defineScreens` with the station screens and the plugin screens. |
| `@agent-native/line-station/*` | see file | `contracts` (browser-safe), `domain`, `policy`, `server`, `bridge`, `station-bridge`, `driver-bridge`, `fake-mes`. |

The station route is the station bridge or the automation route. The screens are stations, the station surface, device setup, the bridge screen and the operator kit, plus Compliance and Drivers from their plugins.

`contracts` composes `contracts/schemas`, `contracts/operation` (descriptions and the capability helper), `contracts/queries` and `contracts/commands`, which are browser-safe like it.

`server` concatenates one handler group per concern from `handlers/`: queries, production, attention, administration, observation, proposals and integration. The groups share `server/`: the handler context and clock, station access, DTOs, attention items and outcome settlement. Every handler checks state and authorization inside its own command.

`ui/station` re-exports the station screens from `ui/station/`: the overview, the MES status and the station surface. The surface has one part per region: header, machine banner, stop reasons, correction, counters, order task, recent stops and requested recipe.

`StationSurface` keeps the command in flight and the open correction through `useStationCommands` and `useAttention`, so live updates do not reset them. Files that issue commands are `.tsx`, because the UI-binding test only reads screen files. `ui/station-kit/` holds the gallery's demo state. The gallery screen owns that state because the inactive tab unmounts.

### Commands

| Command (in this directory) | Purpose |
| --- | --- |
| `bun run dev` | Desktop window on port 4323, with the fake HMI started in-process and bridged. |
| `bun run dev:web` | Browser on port 4323, with the fake HMI started in-process and bridged. |
| `bun run dev:hmi` | The fake HMI alone on port 4610, with simulation endpoints. |
| `bun run station:golden` | Station profile and perception gate on the labeled frames in `golden/`. |
| `bun run station:record-golden` | Re-record golden frames from the fake HMI in Chromium after changing the simulator or profile. |

The bridge starts only when `STATION_HMI_URL` is set, and nothing is discovered. `STATION_ID`, `STATION_PROFILE` and `STATION_OBSERVE_MS` select the station, profile and interval.

Counters on the fake HMI are pixel-only. They need one of these:

- `STATION_SIMULATOR=1`;
- a local vision model: `STATION_VISION_BASE_URL`, `STATION_VISION_MODEL`, `STATION_VISION_ALLOWED_HOSTS`, `STATION_VISION_READS`;
- a perception worker: `STATION_PERCEPTION_WORKER=1` with a `perception-worker` binding in the site policy, started by the process plugin.

[Development and testing](../../docs/development-and-testing.md#station-bridge-demo-and-opt-in-perception) has the full table.

### Automation route

A station whose software has an automation interface, such as a vendor COM server, can be reached through it instead of its screen. The `station-automation` contract carries the screen profile's fields and the same `recipe.load` procedure, with the same precondition, readback and hazard. The driver bridge uses the screen bridge's principal, grant, target, commands and control query. Domain handlers, contracts and screens are the same on both routes.

- The observer reads the driver's state into `line.observation.ingest`. The contract stands where the screen profile stands, `screen` is null, and the `control` field becomes `localInput`.
- The connector delivers `legacy-hmi:<station>` effects to the driver. It sends nothing while the operator holds the seat or the station is under local control, and the mode must allow the hazard.
- A lost reply is read back. A load the station shows is accepted. Otherwise the effect is held for a person, and reconciling it as not applied sends it again.

The driver in `drivers/automation/` is written with the .NET SDK (`sdks/driver-dotnet`). `IStationAutomation` has two implementations:

- `ComStation` binds the vendor's automation server late by ProgID (`STATION_AUTOMATION_PROGID`) on the SDK's handler thread, a single-threaded apartment on Windows. Its member names are this reference's assumption; map them to the real object model there.
- `SimulatedStation` keeps a station in `STATION_AUTOMATION_SIM_DIR`, for the demo and the tests.

`StationAutomationContract.cs` is generated from the contract, and the header of `Program.cs` has the commands. `StationAutomation.slnx` opens the driver and the SDK project it references in an IDE.

The route starts only when configured, with `createLineStationApplication({ automation })` or `STATION_ROUTE=automation` in the demo. It also needs a site-policy binding for the `station-automation-driver` process. Bind the published driver executable, and set one of the two variables in the binding's environment. A host serves one station on this route, because the driver runs on the station PC.

## Trust boundary

These principals touch the module:

- **People** hold operator, supervisor or viewer roles per station.
- **Each station's bridge** (`station-bridge:<station>`) may only submit what the screen shows and settle screen procedures.
- **The MES integration** (`MES_PRINCIPAL`) may only sync orders and reasons and settle forwarded records. Its grant cannot reach station screens, observations or any person's command.

Neither integration principal can act as a person.

The bridge acts only in the [bridge mode](../../docs/glossary.md#bridge-mode) the station sets (`monitor-only`, `assist`, `actuate`), and only while it holds the seat. An operator takes over with one tap. Unsure counter reads become attention items for a person instead of facts.

The MES is not idempotent, so forwarded stops are delivered exactly once by lookup. `station-bridge.ts` and `fake-hmi/` are reviewed egress exemptions in `scripts/boundary-rules.ts`.

## Dependencies

Framework and plugins: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/integration`, `@agent-native/station`, `@agent-native/devices`, `@agent-native/frame`, `@agent-native/site`, `@agent-native/network`, `@agent-native/process`, `@agent-native/audit`, `@agent-native/compliance`, `@agent-native/automation` and `@agent-native/connector-driver`. The tests also use `@agent-native/testing`, `@agent-native/adapters` and `@agent-native/client`.

Operator parts come from `@agent-native/operator-ui` through the `@/` alias. External: `zod`, `react`, `@tanstack/react-query`, `@tanstack/react-router` and `lucide-react`. `@playwright/test` drives the HMI's browser screen.

The automation driver builds with the .NET 10 SDK against `sdks/driver-dotnet`, with no NuGet packages. Content must never import `apps/*`.

## Tests

```sh
bun test examples/line-station
bunx playwright test examples/line-station/e2e
```

- `domain.test.ts`:
  - observations with provenance;
  - exactly-once MES forwarding;
  - recipe loads accepted by readback;
  - monitor-only and seat holds;
  - popups and takeover held for reconciliation;
  - unsure reads asking a person;
  - principals staying in their lane.
- `test/conformance.test.ts`: a station observed through its screen reads the same on every surface, and lanes stay separate.
- `test/application.test.ts`: the state upgrade is idempotent. A station is bridged only when named, on one route. Drain reports the station targets it cannot deliver.
- `test/automation.test.ts`: the domain scenarios on the automation route with a fake driver:
  - provenance and stops;
  - a load accepted by readback;
  - monitor-only, seat and local control holding effects;
  - a lost reply read back, and one held and reconciled.
- `test/automation-driver.test.ts`: the .NET driver with its simulated station, skipped without `dotnet`:
  - the committed stub matches the contract;
  - `checkDriver` passes;
  - a load is accepted by readback;
  - a crash after a load the station does not show is held and then reconciled.
- `golden.test.ts`: the recorded golden frames pass the station profile gate.
- `test/proposals.test.ts`:
  - the stop explainer proposes and cannot classify;
  - a viewer and the run cannot accept;
  - an operator's acceptance classifies as the operator;
  - proposals stay at their station;
  - a stale stop conflicts, and a demoted operator is refused;
  - the expiry job closes only expired proposals at the stations of whoever enabled it.
- `test/ui-bindings.test.ts`: every capability that claims a UI binding is referenced by a screen.
- `e2e/station.pw.ts`, in Chromium: hold-to-confirm, tile hotkeys versus wedge scans, keypad tolerance, takeover, and a stop observed on the fake HMI and classified end to end.

The COM implementation builds on every OS but has not run on Windows yet. The tests use the simulated station.

The deterministic golden gate replays recorded expectations, so it checks wiring only. A live vision-model gate is a separate result, recorded in the [implementation status](../../docs/implementation-status.md).

## Skills

- [bridge-station-screen](../../packages/station/skills/bridge-station-screen/SKILL.md) covers the station profile, the screen bridge, the golden check and the choice of route.
- [write-hardware-driver](../../plugins/connector-driver/skills/write-hardware-driver/SKILL.md) covers the automation driver.
- [add-scanner-input](../../packages/devices/skills/add-scanner-input/SKILL.md) covers the scanner sources and device configuration.
- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md) covers the MES target.
- [build-screens](../../packages/frame/skills/build-screens/SKILL.md) covers the station surface and the operator registry.

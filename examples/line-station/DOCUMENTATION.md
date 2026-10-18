# Line station

Line station is an example application for operators at the stations of a production line. It observes and drives station software through its screen or, where the software has one, through its automation interface. Stops, count confirmations and recipe loads leave through the outbox, to a homebrew MES or to the station software. This page is for someone building a similar application by hand or with a coding agent. The [line-station README](README.md) describes the workspace, its entrypoints and its trust boundary.

## Demonstrated mechanisms

Paths in the Code and Proof columns are relative to the example directory. A path that starts with a framework, plugin or script directory is relative to the root.

| Mechanism | Code | Proof |
| --- | --- | --- |
| [Module](../../docs/primitives.md#module) of [capabilities](../../docs/primitives.md#capability) with descriptions | `contracts.ts` `lineStationModule`, `contracts/operation.ts` `operation` | `test/conformance.test.ts`: one result over direct, HTTP, CLI and MCP |
| [Capability binding](../../docs/primitives.md#capability-binding) or a declared exception per capability | `contracts/operation.ts` `operation`, `ui/` | `test/ui-bindings.test.ts` |
| [Host plugins](../../docs/primitives.md#host-plugin) in all three entrypoints | `manifest.ts`, `application.ts`, `screens.tsx` | `test/ui-bindings.test.ts`: the plugins' bound operations are referenced by their screens; `test/conformance.test.ts` starts the composed host |
| [Membership](../../docs/primitives.md#membership) per station | `contracts/membership.ts`, `handlers/administration.ts` | `test/proposals.test.ts`: a demoted operator is refused |
| [Policy](../../docs/primitives.md#policy) with station roles and person-only commands | `policy.ts` `linePolicy` | `domain.test.ts`: an agent run cannot start an order |
| Lanes for the bridge and MES [integration principals](../../docs/authorization.md) | `policy.ts` `integrations`, `handlers/integration.ts` `settles` | `domain.test.ts`: "integration principals stay in their lane" |
| [Journal and live query](../../docs/primitives.md#journal-and-live-query) with per-station event visibility | `policy.ts` `events`, `ui/station/station-surface.tsx` | `domain.test.ts`: the completed order gets its own journal entry; per-station visibility is untested |
| [Target](../../docs/primitives.md#target) for the MES | `contracts/target.ts` `mesTarget` | `test/application.test.ts`: the embedded authority syncs and drains it |
| [Outbox effect](../../docs/primitives.md#outbox-effect) and [dispatcher](../../docs/primitives.md#dispatcher) to a non-idempotent MES | `handlers/production.ts`, `fake-mes.ts` `lookup` | `domain.test.ts`: a classified stop is forwarded exactly once |
| [Inbound sync](../../docs/primitives.md#inbound-sync) of orders and stop reasons | `handlers/integration.ts` `applyBatch`, `fake-mes.ts` `toSyncInput` | `test/conformance.test.ts`; the unknown-station rule is untested |
| [Observation](../../docs/primitives.md#observation) through an ingest command | `handlers/observation.ts`, `bridge.ts` | `domain.test.ts`: readings with provenance; stops open and close |
| Uncertain [observations](../../docs/primitives.md#observation) as attention items | `handlers/observation.ts` `recordReadings`, `handlers/attention.ts` | `domain.test.ts`: unsure counter reads ask a person |
| [Revision](../../docs/interaction-contract.md) check on observed counters | `server/access.ts` `counters`, `handlers/observation.ts`, `handlers/attention.ts` | `domain.test.ts`: counts that changed after a look conflict |
| Station [profile](../../docs/primitives.md#profile) | `station-profile.json`, `bridge.ts` `filler` | `golden.test.ts` |
| [Gated actuator](../../docs/primitives.md#gated-actuator) behind a screen [connector](../../docs/primitives.md#connector) | `bridge.ts` `createLineStationBridge` | `domain.test.ts`: monitor-only, seat and takeover tests |
| Held effect and [reconciliation](../../docs/primitives.md#reconciliation) | `handlers/attention.ts` `reconcileEffect`, `server/attention.ts` | `domain.test.ts`: a vendor popup holds the effect |
| [Golden check](../../docs/primitives.md#golden-check) | `golden/`, `fake-hmi/record-golden.ts`, `scripts/station-golden.ts` | `golden.test.ts` |
| Perception sources for pixel-only fields, per the [operator workstation pattern](../../docs/operator-workstation-pattern.md#observation-and-local-models) | `station-bridge.ts` `counterExtractor` | `e2e/station.pw.ts`, simulator source only |
| [Driver contract](../../docs/primitives.md#driver-contract) for the automation interface | `contracts/automation.ts` | `test/automation-driver.test.ts`: the committed stub matches |
| Driver [connector](../../docs/primitives.md#connector) and observer on the bridge principal | `driver-bridge.ts` | `test/automation.test.ts` |
| [Driver process](../../docs/primitives.md#driver-process) on the .NET [driver SDK](../../docs/primitives.md#driver-sdk) | `drivers/automation/` | `test/automation-driver.test.ts`, skipped without `dotnet` |
| Driver start through the [process port](../../docs/primitives.md#process-port) | `application.ts` `startAutomation` (availability check), `createDriverPlugin` | None in the example |
| [Agent definition](../../docs/primitives.md#agent-definition) that makes [proposals](../../docs/primitives.md#proposal) | `contracts.ts` `stopExplainer`, `handlers/proposals.ts` | `test/proposals.test.ts` |
| [Trigger](../../docs/primitives.md#trigger) under a [standing grant](../../docs/primitives.md#standing-grant) | `automation.ts` | `test/proposals.test.ts`: the expiry job only |
| [Requirement declarations](../../docs/primitives.md#requirement-declaration) and host components | `contracts.ts` `requirements`, `manifest.ts` | None in the example |
| Scanner [configuration module](../../docs/primitives.md#configuration-module) | `manifest.ts`, `application.ts` `deviceAuthorizationRoute` | `test/conformance.test.ts`: operators read, supervisors save |
| Scanner [input source](../../docs/primitives.md#input-source) | `ui/station/order-task.tsx` | `e2e/station.pw.ts` |
| Operator [UI registry](../../docs/primitives.md#ui-registry) parts | `ui/station/station-surface.tsx`, `ui/station-admin.tsx` | `e2e/station.pw.ts` |
| [State migration](../../docs/primitives.md#state-migration) by the unversioned upgrade for workspaces from before proposals | `application.ts` `upgradeState` | `test/application.test.ts`: the upgrade leaves a current state unchanged; the backfill for an older workspace is untested |

Framework tests cover what the example leaves untested:

- **Trigger and standing grant**: `plugins/automation/test/automation.test.ts`, including "a schedule runs once per slot" and "only people issue, renew and revoke grants".
- **Driver start**: `plugins/connector-driver/test/plugin.test.ts` starts a driver through the process port on first use.
- **Vision and worker extractors**: `packages/station/test/perception.test.ts`.

## Structure

| Path | Holds |
| --- | --- |
| `contracts.ts`, `contracts/` | Schemas, queries, commands, the MES target, station membership, the driver contract, the stop explainer and the module's network requirements. Browser-safe. |
| `domain.ts` | State types, `createLineState`, the bridge principal and target names, and reading freshness (30 seconds). |
| `policy.ts` | `linePolicy`: station roles, person-only commands, the bridge and MES lanes, journal event visibility. |
| `server.ts`, `handlers/`, `server/` | One handler group per concern, and the shared context, access checks, DTOs, attention items and outcome settlement. |
| `manifest.ts` | The manifest: modules, plugin manifests and host components, including the screen bridge's browser. |
| `application.ts` | The application definition: state, plugins, handlers, authorization and `connect` for the MES and the station routes. |
| `automation.ts` | The `expire-proposals` trigger and its job. |
| `bridge.ts` | The screen route: observer, screen connector and dispatcher under one bridge principal. |
| `station-bridge.ts` | Starts the screen route against a browser-based station screen with Playwright and picks the counter extractor. |
| `driver-bridge.ts` | The automation route: driver observer, driver connector and dispatcher under the same bridge principal. |
| `station-profile.json` | The station profile of the simulated filler HMI. |
| `drivers/automation/` | The .NET driver: generated contract stub, `IStationAutomation`, `ComStation` and `SimulatedStation`. |
| `fake-mes.ts` | `FakeMes`, an in-memory MES with non-idempotent bookings, lookup by effect ID and an ordered feed. |
| `fake-hmi/`, `dev.ts` | The simulated HMI, its in-memory transport, simulator OCR and golden recorder, and the development start that runs it in process. |
| `golden/` | Recorded frames, their images and the labeled manifest for the golden check. |
| `screens.tsx`, `ui/` | Routes, the station surface, the bridge and scanner screens, and the operator kit gallery. |
| `domain.test.ts`, `golden.test.ts`, `test/`, `e2e/` | Tests listed in the README; `test/automation-route.ts` is the shared setup of the automation-route tests. |

## Observation and stop flow

The station software's state enters as observations, and an operator's stop classification leaves for the MES.

1. The observer in `bridge.ts` captures a frame through the screen transport and runs the profile's extractors on it. A reading is kept only after it agrees across the field's `stableReads` captures.
2. A kept reading is `observed` at or above the field's minimum confidence, and `uncertain` below it. The observer submits `line.observation.ingest` as `station-bridge:<station>`, under a grant of three operations.
3. The observer's idempotency key fingerprints the payload. Unchanged content is resubmitted at most once per heartbeat window.
4. The policy admits the bridge principal for its own station only. People cannot submit observations (`test/conformance.test.ts`).
5. The ingest handler in `handlers/observation.ts` ignores an observation older than the last applied one. Observed readings replace the record and keep their source, model, frame digest and profile.
6. An uncertain reading becomes an attention item unless it equals the recorded value or the open item's value. A person resolves it with `line.reading.confirm`, which checks the value against the field's declared type.
7. A confident change from running to stopped or alarm opens a stop, and a return to running closes it. A change of good or scrap bumps the `counters:<station>` revision.
8. An operator picks a reason on the station surface, which calls `line.stop.classify`. The handler in `handlers/production.ts` checks the reason and the stop's sync state, records the classification and enqueues a `stop.post` effect on target `mes`.
9. The MES dispatcher that `connectTarget` starts in `application.ts` delivers the effect as `mes-integration`. The fake MES declares non-idempotent delivery, so the dispatcher looks the effect ID up before it sends again.
10. The dispatcher settles through `line.effect.settle`. The settle handler accepts only MES effects from the MES principal, and `server/sync.ts` records the sync state, the MES reference or the rejection on the stop.

Count confirmation follows the same outbox path with a `count.post` effect. It refuses readings that are stale or neither confident nor verified by a person.

## Recipe load flow

Starting an order changes the station software, so the effect goes to the station instead of the MES.

1. An operator scans or picks a released order and holds the start button in `ui/station/order-task.tsx`. The client calls `line.order.start`.
2. The policy requires an operator or supervisor at the station and refuses delegated callers. The handler in `handlers/production.ts` refuses an order that is not released there, a load already pending, or a fresh reading that the machine is not stopped.
3. The handler records the desired recipe on the station and enqueues a `recipe.load` effect on target `legacy-hmi:<station>`. The payload carries the recipe, the order and the caller as `presence.confirmedBy`.
4. The station bridge's dispatcher in `bridge.ts` delivers effects for that target to the screen connector. The connector rejects the effect at once if the procedure needs a person present and the payload names none.
5. The connector reads `line.control.get`. Effects stay pending while the operator holds the seat, in `monitor-only` mode, or in `assist` mode for a hazardous procedure.
6. The connector accepts at once if the screen already shows the recipe. It requires the start screen, and it rejects with `PRECONDITION` when the machine is not stopped.
7. The connector runs the profile's steps. Before each click, type or key it rereads the control state and checks local input, the step budget, the timeout and the expected screen. Before a click it also refuses a point inside a forbidden region.
8. The connector accepts when the recipe reads back across the field's stable reads. An interruption after the first screen action, such as a vendor popup or a takeover, holds the effect, because the procedure is not rerunnable.
9. A held effect appears as a reconcile item in `line.attention.list`. A person at the station calls `line.effect.reconcile`, which settles it as applied or releases it for another delivery.
10. The dispatcher settles through `line.effect.settle`, which accepts only this station's target from this station's bridge principal. The outcome marks the order active and completes the order the station leaves.

On the automation route, `driver-bridge.ts` replaces steps 4 to 8 with the driver connector. It applies the mode, presence, precondition and readback rules from the driver contract, and the seat rule in its control callback. It also waits while the station is under local control, as the README's [automation route](README.md#automation-route) section describes. The .NET driver reads the station again before it loads, and refuses under local control or when the machine is not stopped.

## Implementation steps

These steps start from the exported example and name the file to change in it. File paths are relative to `examples/line-station` in the exported project. Commands run from the exported project's root unless a step names another directory.

1. From the root of the starter checkout, export the example with the [create-agent-native-app skill](../../packages/scaffold/skills/create-agent-native-app/SKILL.md), then install the export's dependencies. The export keeps the example in its own directory, and `app.config.json` names it as the hosted application.

   ```sh
   bun run scaffold ../my-station-app --name my-station-app --example line-station
   cd ../my-station-app
   bun install --frozen-lockfile
   ```

2. Rename the operation IDs in `contracts/`, then follow the type errors and failing tests through the handlers, policy, screens and tests. The [add-capability skill](../../packages/runtime/skills/add-capability/SKILL.md) covers contracts, handlers and tests.
3. Change the schemas and capabilities in `contracts/schemas.ts`, `contracts/queries.ts` and `contracts/commands.ts`. Give each a description in `contracts/operation.ts`, and keep the `target` option on commands that change another system.
4. Change the network requirements of the module in `contracts.ts` to the destinations your station screen and MES use. Keep the host components in `manifest.ts` that your routes need.
5. Change the MES target in `contracts/target.ts`, its handlers in `handlers/integration.ts` and the status shape of `syncStatus` in `handlers/queries.ts`. Keep the `settles` override, because the bridge principals settle through the same operation.
6. Change the commands in `handlers/production.ts`. Each records the desired state and calls `ctx.enqueue` for the MES target or for `legacy-hmi:<station>`.
7. Change the observation handler in `handlers/observation.ts` and the field names in `FIELDS` in `domain.ts` to the fields your domain interprets. Keep the rule that an uncertain reading becomes an attention item.
8. Keep reading confirmation and the reconcile command in `handlers/attention.ts` when a decision changes more than the effect and its record. Otherwise compose `reconciliationOperations` from the contracts package with the runtime's `reconciliationHandlers`, as the [receiving example](../receiving/DOCUMENTATION.md) does; the export does not contain that example.
9. Keep the mode and seat commands in `handlers/administration.ts` and the control query in `handlers/queries.ts`. Both routes read the control query before they act.
10. Change `policy.ts` for your roles and resources, and keep these parts.
    - `person: true` on commands that need a person at the station.
    - One `integrations` lane whose `is` matches every bridge principal and whose `allow` limits each to its own station.
    - `targetLane` with `targetRules` for the MES.
    - An `events` entry for each resource type, so a person sees a station's changes only with a role at that station.
11. Write a station profile for your station software in place of `station-profile.json`, with screens, fields, forbidden regions and procedures. The [bridge-station-screen skill](../../packages/station/skills/bridge-station-screen/SKILL.md) covers profiles, extractors and the gate.
12. Capture frames of your station screen with its transport, and write each frame's expected values into `golden/manifest.json`. Then run the gate in the example directory.

    ```sh
    (cd examples/line-station && bun run station:golden)
    ```

    The recorder in `fake-hmi/record-golden.ts` shows the manifest format and records the simulated HMI only. Without a configured model, the gate replays the expected values and checks the wiring only.

13. Take `network` in the `connect` of `application.ts`, and pass it through `startBridges` and `startStationBridge` to `counterExtractor` in `station-bridge.ts`. There, give the vision extractor's `fetch` option `network.routedFetch(['station-vision', 'station-vision-site'])`.
14. Replace the `startStationBridge` call in `startBridges` of `application.ts` when your screen is not a web page, because that starter always launches Chromium. Write a `ScreenTransport` for your screen and pass it to `createLineStationBridge`.
15. For a station with an automation interface, change the driver contract in `contracts/automation.ts` to the same fields and procedure as the profile. The [write-hardware-driver skill](../../plugins/connector-driver/skills/write-hardware-driver/SKILL.md) covers the contract, the plugin and the SDKs.
16. Keep the driver plugin in all three entrypoints: `driverPluginManifest` in `manifest.ts`, `createDriverPlugin` in `application.ts` and `driverScreens` in `screens.tsx`.
17. Keep the `control` callback in `driver-bridge.ts`, which reads the same control query and returns its mode to the driver connector. While the operator holds the seat, it throws `DeliveryFailure` instead.
18. Map the member names in `drivers/automation/ComStation.cs` to the vendor's COM object model. Then regenerate the stub and build the driver, with every other output under `artifacts/`.

    ```sh
    mkdir -p artifacts
    bun run cli driver contract station-automation --out artifacts/station-automation.json
    dotnet run --project sdks/driver-dotnet/src/AgentNative.Driver.Stubgen --artifacts-path artifacts -- artifacts/station-automation.json --namespace StationAutomation -o examples/line-station/drivers/automation/StationAutomationContract.cs
    dotnet build examples/line-station/drivers/automation/StationAutomation.csproj --artifacts-path artifacts
    ```

    These commands overwrite the example's committed stub, so substitute your own driver ID, namespace and output path. The root ignore file covers `artifacts/`, and you can delete the directory after the next step.

19. Check the built driver against its contract.

    ```sh
    bun run cli driver check station-automation -- /usr/bin/env "STATION_AUTOMATION_SIM_DIR=$PWD/artifacts/station" "$(command -v dotnet)" "$PWD/artifacts/bin/StationAutomation/debug/StationAutomation.dll"
    ```

    The check starts the executable with only the base environment of `plugins/process/src/spawn.ts`, so the simulated station's directory goes in through the env command. It never invokes an action. The suite in `test/automation-driver.test.ts` runs the same checks.

20. Bind the processes and destinations in the site policy with the [deploy-to-site skill](../../plugins/site/skills/deploy-to-site/SKILL.md). The process IDs are `station-automation-driver`, `perception-worker` and `station-bridge-browser`, and `bun run cli driver list` prints the driver's process ID and contract digest.
21. Replace `FakeMes` in the `connect` of `application.ts` with a `SystemOfRecordPort` built from the network port and the `mes-api` destination, so it reaches the MES through the egress guard. Keep `toSyncInput` and `MesItem` from `fake-mes.ts` in another file when you delete the fake.
    - `httpTargetPort` in `plugins/connector-http` covers a REST MES and needs a lookup or an idempotency header. Pass it `network` with `destination: 'mes-api'`, and a feed whose `map` returns the item that `toSyncInput` reads.
    - `connectorConformance` from the testing package's connectors entrypoint tests the connector.
22. Pass your screen-route stations as the `stations` option of `createLineStationApplication` in the default export of `application.ts`. Pass the one automation-route station as its `automation` option; the two options replace the demo environment that `demoStations` and `demoAutomationStation` read.
23. Change `freshLine` in `application.ts` to create your stations, because no command adds a station.
24. Change the stop explainer's instructions and operations in `contracts.ts`, and the proposal rules in `policy.ts` for the records it proposes about.
25. Change the trigger and its job in `automation.ts`. Keep the automation plugin in all three entrypoints: `automationPluginManifest` in `manifest.ts`, `lineAutomationPlugin` in `application.ts` and `automationScreens` in `screens.tsx`.
26. Keep the site, network, process, audit and compliance plugins in `manifest.ts` and `application.ts`, and the compliance screens in `screens.tsx`.
27. Change the screens in `ui/` and the routes in `screens.tsx`, with live queries and catalog commands only. Use the [build-screens skill](../../packages/frame/skills/build-screens/SKILL.md) and, for scanners, the [add-scanner-input skill](../../packages/devices/skills/add-scanner-input/SKILL.md).
28. Change the tests to your domain.
    - `domain.test.ts`: the domain over the in-memory simulator transport and a fake MES.
    - `test/conformance.test.ts`: direct, HTTP, CLI and MCP results, and the lanes.
    - `test/proposals.test.ts`: proposals, their conflicts and the expiry job.
    - `test/application.test.ts` and `golden.test.ts`: the demo configuration, the embedded authority and the golden gate.
    - `test/automation.test.ts` and `test/automation-driver.test.ts`: the automation route over a fake driver and the built driver.
    - `test/ui-bindings.test.ts` and `e2e/station.pw.ts`: the bindings and the browser run against a separate fake HMI process.
29. Run the checks with the [check-a-change skill](../../packages/testing/skills/check-a-change/SKILL.md).

    ```sh
    bun test examples/line-station
    bunx playwright test examples/line-station/e2e
    bun run check
    ```

## Limits

- **Screen transports**: only a Playwright page is provided, so only browser-based station screens are reachable. VNC, RDP, KVM-over-IP and UI Automation transports do not exist ([station README](../../packages/station/README.md)).
- **Computer use**: the screen connector uses the scripted driver that resolves targets from locators. No live computer-use model has driven a screen.
- **Perception models**: no OCR or vision model has been called. The golden test replays recorded expectations, which checks wiring and not model accuracy ([implementation status](../../docs/implementation-status.md#operator-workstation-bridge)).
- **Golden gate**: a station profile activates without a passing golden report. The gate is a separate procedure.
- **Local input on screens**: only the simulated HMI reports local input. A real station screen needs its own input hook before an operator's keyboard use stops a procedure.
- **COM automation**: `ComStation` has never run on Windows, and its member names are an assumed object model. The driver tests use `SimulatedStation` only ([implementation status](../../docs/implementation-status.md#hardware-drivers)).
- **Served automation route**: a host starting the driver from a site binding has not run. The tests start the driver directly.
- **Automation route stations**: the automation route serves one station per host, because the driver runs on the station PC.
- **Stations**: a new workspace gets exactly one station, `line-1`, with its creator as supervisor. No command adds a station, and MES orders for unknown stations are ignored.
- **Egress**: `station-bridge.ts` launches Chromium, reads simulator counters and probes local input outside the egress guard, as a reviewed exemption. The vision extractor gets no guarded client there, but it still refuses endpoints that are neither loopback nor allowlisted.
- **Seat**: the seat has no expiry. A holder that disappears keeps it until someone changes it.
- **Concurrent recipe loads**: a station refuses a new order while a recipe load is pending or held.
- **Safety**: the bridge is not safety-rated. Forbidden regions keep procedures off e-stop reset, jog and start, and the machine keeps its own safety functions.

## Related pages

- [Line-station README](README.md)
- [Operator workstation pattern](../../docs/operator-workstation-pattern.md)
- [Hardware drivers](../../docs/hardware-drivers.md)
- [System-of-record pattern](../../docs/system-of-record-pattern.md)
- [Point-of-work input](../../docs/point-of-work-input.md)
- [Bridge-station-screen skill](../../packages/station/skills/bridge-station-screen/SKILL.md)
- [Write-hardware-driver skill](../../plugins/connector-driver/skills/write-hardware-driver/SKILL.md)
- [Quality inspection](../quality-inspection/DOCUMENTATION.md), which reaches an instrument through a Python driver
- [Receiving](../receiving/DOCUMENTATION.md), which reconciles held effects with the framework's reconciliation operations

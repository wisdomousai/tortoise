# Winding-line workstation

An operator runs a winder that makes coils for control transformers. The existing workstation application owns the machine state, recipe and counters; a separate MES owns orders and stop reasons. This application observes the workstation, helps the operator classify stops and confirm counts, and delivers those records to the MES.

The development setup uses a fake HMI and fake MES. The [screen bridge](../../../docs/operator-workstations.md) reads the HMI and runs declared procedures; an optional driver route uses an automation interface instead.

## Try the station

From the repository root:

```sh
cd showcase/examples/winding-line
bun run dev:web
```

The browser host listens on port 4323 and starts the fake HMI. `bun run dev` opens a desktop window; `bun run dev:hmi` starts only the fake HMI on port 4610. The demo selects simulator mode unless a recognition model or worker is configured. The simulator supplies ground truth for pixel-only counters, so the demo does not prove visual recognition.

A custom launch starts the bridge only when `STATION_HMI_URL` is set. `STATION_ID`, `STATION_PROFILE` and `STATION_OBSERVE_MS` select the station, profile and interval. For profile changes, run `bun run station:golden`; without a configured model that replays expectations and checks the wiring.

## From observation to stop report

1. The bridge reads the workstation screen according to [`station-profile.json`](station-profile.json). Stable, confident [observations](../../../docs/primitives.md#observation) update the station with their provenance; uncertain readings become attention items for a person.
2. A confident transition to stopped or alarm opens a stop. The operator chooses a reason on the station screen. The classification and an MES delivery effect commit together.
3. The dispatcher sends the stop to the MES and records the returned reference or rejection. Count confirmation uses the same path and refuses stale or unverified readings.

The observer is wired in [`bridge.ts`](bridge.ts), observation handling is in [`handlers/observation.ts`](handlers/observation.ts), and production commands are in [`handlers/production.ts`](handlers/production.ts).

## Loading a recipe

An operator selects a released order and holds the start control. The application records the desired recipe and queues a `recipe.load` effect for the station. The bridge checks the mode, control holder, person-presence requirement and stopped-machine precondition before acting. After the declared screen steps, readback must show the recipe before the effect is accepted. An interruption after an action is held for a person to reconcile; the bridge does not assume the action can be safely repeated.

## Automation route

A station whose software has an automation interface, such as a vendor COM server, can be reached through it instead of its screen. The `station-automation` contract includes the screen profile's fields and the same `recipe.load` procedure, with the same precondition, readback and risk level. The driver bridge uses the screen bridge's principal, grant, target, commands and control query. Domain handlers, contracts and screens are the same on both routes.

- The observer reads the driver's state into `line.observation.ingest`. The contract stands where the screen profile stands, `screen` is null, and the `control` field becomes `localInput`.
- The connector delivers `legacy-hmi:<station>` effects to the driver. It sends nothing while the operator holds control or the station is under local control, and the mode must allow the risk level.
- A lost reply is read back. A load the station shows is accepted. Otherwise the effect is held for a person, and reconciling it as not applied sends it again.

The driver in `drivers/automation/` is written with the .NET SDK (`sdks/driver-dotnet`). `IStationAutomation` has two implementations:

- `ComStation` binds the vendor's automation server late by ProgID (`STATION_AUTOMATION_PROGID`) on the SDK's handler thread, a single-threaded apartment on Windows. Its member names are this reference's assumption; map them to the real object model there.
- `SimulatedStation` keeps a station in `STATION_AUTOMATION_SIM_DIR`, for the demo and the tests.

The route starts only when configured, with `createWindingLineApplication({ automation })` or `STATION_ROUTE=automation` in the demo. It also needs a site-policy binding for the `station-automation-driver` process. Bind the published driver executable, and set one of the two variables in the binding's environment. A host serves one station on this route, because the driver runs on the station PC.

## Trust boundary

The workstation application authorizes these principals:

- **People** hold operator, supervisor or viewer roles per station.
- **Each station's bridge** (`station-bridge:<station>`) may only submit what the screen shows and complete screen procedures.
- **The MES integration** (`MES_PRINCIPAL`) may only sync orders and reasons and complete forwarded records. Its grant cannot reach workstation screens, observations or any person's command.

Neither integration principal can act as a person.

The bridge acts only in the [bridge mode](../../../docs/glossary.md#bridge-mode) the station sets (`monitor-only`, `assist`, `actuate`), and only while it holds control. An operator takes over with one tap. Unsure counter reads become attention items for a person instead of facts.

The MES is not idempotent, so forwarded stops are delivered exactly once by lookup. `station-bridge.ts` and `fake-hmi/` are reviewed egress exemptions in `scripts/boundary-rules.ts`.

## Limits

- **Screen transports**: only a Playwright page is provided, so only a browser-based screen is reachable. VNC, RDP, KVM-over-IP and UI Automation transports do not exist ([screen bridge README](../../../workstations/screen-bridge/README.md)).
- **Computer use**: the screen connector uses the scripted driver that resolves targets from locators. No live computer-use model has operated a screen.
- **Recognition models**: no OCR or vision model has been called. The golden test replays recorded expectations, which checks wiring and not model accuracy ([implementation status](../../../docs/implementation-status.md#operator-workstation-bridge)).
- **Golden gate**: a station profile activates without a passing golden report. The gate is a separate procedure.
- **Local input on screens**: only the simulated HMI reports local input. A real screen needs its own input hook before an operator's keyboard use stops a procedure.
- **COM automation**: `ComStation` has never run on Windows, and its member names are an assumed object model. The driver tests use `SimulatedStation` only ([implementation status](../../../docs/implementation-status.md#hardware-drivers)).
- **Served automation route**: a host starting the driver from a site binding has not run. The tests start the driver directly.
- **Automation route stations**: the automation route serves one station per host, because the driver runs on the station PC.
- **Stations**: a new workspace gets exactly one station, `winder-1`, with its creator as supervisor. No command adds a station, and MES orders for unknown stations are ignored.
- **Egress**: `station-bridge.ts` launches Chromium, reads simulator counters and probes local input outside the egress guard, as a reviewed exemption. The vision extractor gets no guarded client there, but it still refuses endpoints that are neither loopback nor allowlisted.
- **Control**: control has no expiry. A holder that disappears keeps it until someone changes it.
- **Concurrent recipe loads**: a station refuses a new order while a recipe load is pending or held.
- **Safety**: the bridge is not safety-rated. Forbidden regions keep procedures off e-stop reset, jog and start, and the machine keeps its own safety functions.

## Checks

From the repository root:

```sh
bun test showcase/examples/winding-line
bunx playwright test showcase/examples/winding-line/e2e
```

The tests exercise the fake HMI, fake MES and station permissions. The .NET automation-driver test uses a simulated station and skips without `dotnet`. No screen bridge or driver in this framework is safety-rated; consult [implementation status](../../../docs/implementation-status.md#operator-workstation-bridge) for actual device and model evidence.

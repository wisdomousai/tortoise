# Operator workstations

An [application](glossary.md#application) observes and operates a [workstation application](glossary.md#workstation-application) through its [screen](glossary.md#screen). The example is [`examples/line-station`](../examples/line-station/README.md).

A workstation application has no API and must stay unmodified. Where its only stable interface is its screen, the application treats it as a [system of record](systems-of-record.md) reached through that screen. Software with an automation interface, such as COM, a local RPC service, files or a decodable network protocol, is reached through a [driver](hardware-drivers.md) instead, as [Automation route](#automation-route) describes.

The application monitors the workstation and lets operators and agents act through its [catalog](glossary.md#catalog). The screen bridge is its only path to the workstation application. The workstation application keeps the interaction with the controller and the hardware.

## Concepts

Terms: [station profiles](glossary.md#station-profile), [procedures](glossary.md#procedure), [bridge modes](glossary.md#bridge-mode), [risk levels](glossary.md#risk-level), the [interlock](glossary.md#interlock), the [control holder](glossary.md#control-holder), [terminals](glossary.md#terminal) and [workstation sign-in](glossary.md#workstation-sign-in).

## Workstation application and the MES

```mermaid
flowchart TB
  ERP[(ERP)] --- MES[(MES, often homebrew: a system of record)]
  MES --- Station[Workstation application: vendor HMI, test bench, MES client]
  Station --- PLC[PLC or controller]
  PLC --- HW[Machine hardware]
  subgraph App[Application: one instance, one catalog]
    UI[Screens] --> Instance[Commands, queries, journal]
    MCP[MCP, CLI, agents] --> Instance
    Instance --> Outbox[Outbox]
  end
  Outbox -->|API connector| MES
  MES -->|inbound sync| Instance
  Outbox -->|station connector| Station
  Station -->|station observer: accessibility tree, OCR, vision, audio| Instance
```

The MES is an ordinary system of record. It owns orders, recipes and reason catalogs, and it accepts confirmations. A homebrew MES is often reachable through a database, a file drop or a small HTTP service, and a [connector](glossary.md#connector) uses whichever exists.

The workstation application owns the actual machine state, the loaded recipe and the counters. The application reads them by observing its screen. It changes them only through declared procedures, which the controller performs and then confirms by reading the screen back.

The application never talks to the PLC or the hardware.

## Screen bridge

The screen bridge is a connector behind the [outbox](glossary.md#outbox), like an ERP API client. It is not a [harness](glossary.md#harness) and holds no catalog tools. A request takes these steps:

1. A person or an agent submits a [command](glossary.md#command), such as starting an order. The handler validates it, records the desired state and enqueues an [outbox effect](glossary.md#effect) for the station's target, in one transaction.
2. The [dispatcher](glossary.md#dispatcher) claims the effect outside any transaction and hands it to the screen bridge. The connector runs the declared procedure on the screen, and the dispatcher completes the outcome through the domain's complete command.
3. The station observer reads the screen and submits readings through an ingest command. It never writes storage.

Screens, MCP clients and agents never address the bridge, and the bridge holds no business capabilities. In `line-station`, each station's bridge runs as the [integration principal](glossary.md#integration-principal) `station-bridge:<station>`. Its [grant](glossary.md#grant) holds three capabilities:

| Capability | Use |
| --- | --- |
| `line.observation.ingest` | Submit what the screen shows. |
| `line.effect.complete` | Complete the station's effects, for target `legacy-hmi:<station>`. |
| `line.control.get` | Read the bridge mode and the control holder. |

The application runs without a bridge, and then has no observations. A different computer-use model replaces one computer-use driver and leaves the catalog unchanged.

## Procedure delivery

Screen actions are not idempotent and can be interrupted. A station procedure therefore uses convergent delivery, one of the [delivery modes](hardware-drivers.md#delivery-modes) that hardware drivers define. The station connector handles an effect in this order:

| Step | Rule |
| --- | --- |
| Payload check | A missing presence confirmation rejects with `PRECONDITION`; a missing input value with `INVALID_PAYLOAD`. |
| Bridge state | While the bridge mode or the control holder forbids the procedure, delivery fails transiently. |
| Convergence | A readback that already matches is accepted without acting, so a redelivery after a lost completion is harmless. |
| Start screen | If the screen is not the procedure's start screen, delivery fails transiently. |
| Preconditions | Unreadable ones fail transiently. Unmet ones reject with `PRECONDITION`, and nothing was done. |
| Steps | Each action passes the controller's interlock. A stop before the first action is a transient failure. |
| Readback | A match across the fields' stable reads accepts, with a readback digest as the external reference. |
| Interruption | After the first action, a stop or failed readback redelivers a `rerunnable` procedure and holds any other effect. |

An unexpected screen such as an alarm popup, local input, a timeout or an exhausted step budget stops a procedure. An effect for a type with no procedure is rejected with `UNSUPPORTED`. `workstations/screen-bridge/test/controller.test.ts` tests this order.

A held effect never re-runs and stays visible as needing [reconciliation](glossary.md#reconciliation). The operator states through a reconcile command whether the change was applied. A lost reply does not reject the effect.

## Bridge modes and risk levels

Each station has a bridge mode:

| Bridge mode | What the bridge may do |
| --- | --- |
| `monitor-only` | Observe only. This is the default. |
| `assist` | Run procedures of risk level `none`. |
| `actuate` | Run every declared procedure. |

Each procedure declares a risk level:

| Risk level | Meaning |
| --- | --- |
| `none` | No machine motion. |
| `low` | Changes settings, with no motion. |
| `operator-present` | The effect payload must carry a confirmation that a person is at the station. |

Driver actions use the same bridge modes and risk levels, as the hardware drivers [interlock](hardware-drivers.md#interlock) describes. In `line-station`, only a supervisor at the station may change the bridge mode. A supervisor can pause actuation at any time, and pending effects then wait visibly.

## Deployment stages

1. **Observe.** Machine state, counters, alarms and the loaded recipe become authorized live data with freshness and confidence, and stops are detected from state transitions. This stage has no actuation risk.
2. **Annotate.** People and agents add meaning to observed events, such as stop reasons and count confirmations. Each annotation is an ordinary command, forwarded to the MES through the outbox.
3. **Actuate.** The bridge writes into the workstation application, for example to load the recipe for a scanned order. The bridge mode must permit the procedure's risk level.

In `line-station`, the stop explainer agent requests approval for a stop reason from the alarm text and history. The station shows the [approval request](glossary.md#approval-request), and the operator approves it with one tap. Loading a recipe has risk level `operator-present` and so needs actuate mode. The operator starts the order with a hold-to-confirm, and the command records the operator as the confirming person.

## Interlock

The bridge splits the work across three ports:

- **Screen transport:** captures frames, reads the accessibility tree where it can, performs one action, and reports local input at the station where it can detect it.
- **Computer-use driver:** resolves a declared target to a point on the screen. It never acts.
- **Controller:** performs every action itself, after the interlock.

The interlock runs before every click, key press and typed text. It checks:

- the bridge mode and the control holder, read again through the control query;
- local input since the procedure started, where the transport reports it;
- the expected screen, on a fresh capture;
- that the resolved point lies outside every forbidden region;
- the procedure's step budget and timeout.

A procedure performs only its declared steps and presses only keys from the station profile's allowed list. The reference transport controls a Playwright page. VNC, RDP, KVM-over-IP and Windows UI Automation fit the same port, for sites where nothing may be installed on the vendor PC. The reference computer-use driver is scripted and resolves targets from locators. A local UI-grounding model or a cloud model can implement that port without changing the interlock.

## Control holder

The operator and the bridge share one screen. The control holder is `operator`, `agent` for the bridge, or `idle`. The bridge does not act while the operator holds control, and only a person can request control. Control has no expiry and no fencing token. A holder that disappears keeps control until someone changes it.

The operator's takeover command changes the control holder in the domain state, and the interlock reads it before every action. Local input at the station stops a procedure at once, where the transport detects it. A procedure stopped after its first action follows the interruption rule in [Procedure delivery](#procedure-delivery).

## Observation

Each source of an [observation](glossary.md#observation) implements the [extractor](glossary.md#extractor) port. Prefer the most deterministic source available, in this order:

1. Vendor exports, log files, the station's own database, or an automation interface such as COM or local RPC, read by an inbound connector or an extractor.
2. The accessibility tree of the workstation application, such as UI Automation on Windows.
3. OCR and vision on screen pixels, through local models.
4. Audio, for example to classify alarm horns or spoken notes.

Every reading carries its value, confidence, extractor, model identity, observation time and frame digest. A reading becomes current only after it agrees across the field's configured number of consecutive frames. A stable reading below the field's minimum confidence creates an attention item and does not update state. The operator confirms or corrects it with a large button, and its provenance becomes `operator-verified`.

Local inference keeps frames on site. These [screen recognizers](glossary.md#screen-recognizer) ship:

- **`accessibility`:** deterministic, with confidence 1 for a field it finds.
- **`worker`:** a JSON-lines child process, so any local runtime in any language can serve OCR, classifiers or audio models.
- **`openai-compatible-vision`:** a local vision model behind an OpenAI-compatible endpoint, such as Ollama, llama.cpp server or vLLM. Its output is checked against a JSON schema per field.

A vision endpoint must be loopback or explicitly allowlisted. Its confidence is the agreement across repeated reads, which is a heuristic. `workstations/screen-bridge/test/observer.test.ts` and `workstations/screen-bridge/test/recognition.test.ts` test these rules.

## Station profiles

A station profile holds everything specific to one installation as versioned data. It names:

- the workstation application and the versions it was validated against;
- its screens, recognized by accessibility anchors or a classifier label;
- its fields, each with a locator or region and an extractor;
- the forbidden regions;
- the procedures, each with preconditions, steps, readback, risk level and whether it is rerunnable.

Validation rejects a step that targets a forbidden region or an unknown field, as `workstations/screen-bridge/test/profile.test.ts` shows.

When the vendor updates the workstation application or a model changes, the [golden test](glossary.md#golden-test) replays labeled frames through the profile's extractors. It reports per-field accuracy and confidence. It fails on any confident wrong reading or misidentified screen.

## Automation route

A workstation application that has an automation interface can be reached through a driver instead of its screen. The [driver contract](glossary.md#driver-contract) carries the fields the station profile reads and the same procedures, with the same preconditions, readback and risk levels. Its bridge runs as the same station principal, with the same grant, target and control query. Observations and outbox effects look the same to the domain, so handlers, contracts and screens do not change with the route.

The driver's `control` field takes the place of the screen's local input check. The bridge mode and the control holder are checked for the driver as for the screen. `line-station` configures each workstation on one route. Its automation driver is written in C# against the workstation application's COM server, as the hardware drivers [examples](hardware-drivers.md#examples) describe.

## Workstation sign-in

At a shared workstation, an operator scans a badge at a terminal and enters a PIN of four to eight digits. The operator receives a short-lived [session](glossary.md#session) and acts as that operator. The terminal's screen keeps the terminal's session, used only to sign people in. [`workstations/sign-in`](../workstations/sign-in/README.md) provides this on a serving Bun host.

A terminal is the local owner or a principal listed in the `station-sign-in-terminals` setting, such as a tablet's in [attached mode](glossary.md#attached-mode). The rules:

- Only a terminal's own session may sign people in, and never under a delegated grant. An agent at the terminal cannot open a person's session.
- A session lasts 15 minutes by default, and at most 720. Signing in at a terminal ends the previous session there.
- Five wrong PINs in a row lock the badge for fifteen minutes, even against the right PIN.
- An unknown badge, a revoked badge and a wrong PIN get the same response.
- The badge value and the PIN reach only the plugin's routes and never a stored command input. State keeps digests of badge values and tokens, and a salted scrypt hash of the PIN.
- Sign-out, expiry and badge revocation take effect at the operator's next request.

Signing in does not take control from the bridge. The operator takes the screen back with the takeover command. `workstations/sign-in/test/sign-in.test.ts` tests these rules.

The plugin's terminal screen reads the badge from a scanner and the PIN from the operator registry's keypad. It then shows the application's own screen as the operator, until sign-out, inactivity or expiry. Its badge screen enrolls and revokes badges. `patterns/lab-requests-sign-in` composes both at a lab bench.

## Data ownership

| Data | Owner |
| --- | --- |
| Orders, recipes, reason catalogs, accepted confirmations | MES, imported through [inbound sync](glossary.md#inbound-sync). |
| Actual machine state, loaded recipe, counters, alarms | A workstation application; the application holds observed copies with provenance. |
| Stops and their classification, count confirmations, operator verifications, desired state | Application, forwarded to the MES or station through the outbox. |
| Observation history | Application, bounded, with frame digests in place of retained frames. |
| Scanner profiles and scan routes per station | Application, through the `device` feature. |

## Use

```sh
bun test workstations/screen-bridge
bun test examples/line-station
cd examples/line-station && bun run dev
cd examples/line-station && bun run station:golden
```

`bun run dev` starts the fake HMI in the same process and bridges it. A host starts a bridge only when `STATION_HMI_URL` is set.

## Limits

- The bridge never operates safety functions. A station profile lists emergency-stop reset, interlock override, manual jog and similar controls as forbidden regions, and validation rejects a step that targets one.
- Machine guarding and safety remain the responsibility of the machine and its builder. Nothing here is safety-rated. Regulated environments, such as Good Manufacturing Practice (GMP) or 21 CFR Part 11, need validation for each deployment.
- No live computer-use driver ships, and no VNC, RDP, KVM-over-IP or UI Automation transport.
- The station observer reads frames from a screen transport only.
- Activating a station profile does not require a passing golden test.
- No physical badge reader has been tested, and no example signs people in through the workstation application's screen.

## References

- [Implementation status](implementation-status.md#operator-workstation-bridge)
- [Point-of-work input](point-of-work-input.md)
- [Hardware drivers](hardware-drivers.md)
- [Systems of record](systems-of-record.md)
- [`workstations/screen-bridge`](../workstations/screen-bridge/README.md)
- [`workstations/sign-in`](../workstations/sign-in/README.md)
- [bridge-station-screen](../workstations/screen-bridge/skills/bridge-station-screen/SKILL.md)
- [Held effects](systems-of-record.md#held-effects)
- [Development and testing](development-and-testing.md#station-bridge-demo-and-opt-in-recognition)

# Operator workstations

The screen bridge observes an existing workstation application and executes declared procedures through its screen. It reaches the application through a configured screen transport. It does not provide a PLC protocol or direct machine-control interface.

Application code records desired changes through commands. A command can enqueue an effect for a workstation target. The bridge receives that committed effect through the dispatcher and reports its outcome through the target's completion command. An observer independently submits stable readings through a declared ingest command.

## Who owns what

The workstation application owns the state it displays. An observed value is a local copy with its source and observation time. The Tortoise application owns the records created by its commands and decides how those observations affect them. External record ownership and acceptance are established by the application's target contract.

### Data ownership

A stored observation must retain its provenance and confidence so the application can distinguish observed state from operator verification. Observation history is bounded and retains frame digests. Scanner profiles and scan routes belong to the separate device-configuration feature.

## Screen bridge

The connector is invoked by outbox delivery. Screens and agents submit capabilities to the runtime; they receive no direct bridge-action interface. The bridge's integration principal needs only the operations used to ingest observations, record effect completion and read its control state. The application configures that grant for the relevant workstation.

An application can run without a configured bridge. Its commands remain available subject to normal policy, but the absent bridge supplies no observations or procedure delivery. The [screen-bridge package](../workstations/screen-bridge/README.md) specifies composition.

### Procedure delivery

The connector validates the effect's procedure and payload before acting. An unknown procedure returns `UNSUPPORTED`. An absent required input returns `INVALID_PAYLOAD`, and an unconfirmed presence requirement returns `PRECONDITION`.

The connector then checks the bridge mode and control state. A blocked mode or unavailable control state produces a transient failure. If the declared readback already matches the intended state, the connector accepts the effect without performing its steps.

Otherwise the procedure needs its declared start screen and readable preconditions. An unmet precondition is a rejection. An unreadable precondition or unexpected start screen defers delivery. The controller executes the allowed steps and checks the resulting readback. Acceptance records a readback digest as the external reference.

Local input, a popup or a deadline can interrupt the procedure. The step budget also limits execution. An interruption after an action may leave the effect uncertain. A `rerunnable` procedure can be delivered again under its declared recovery behavior. Other interrupted procedures remain held until a person reconciles whether the requested change occurred. `workstations/screen-bridge/test/controller.test.ts` covers this delivery boundary.

## Bridge modes and risk levels

| Bridge mode | Permitted execution |
| --- | --- |
| `monitor-only` | Observation only; default mode |
| `assist` | Procedures whose risk is `none` |
| `actuate` | Every declared procedure |

| Risk | Meaning |
| --- | --- |
| `none` | No machine motion |
| `low` | A setting change without motion |
| `operator-present` | The payload must confirm a person is present |

Application policy determines who may change the mode and claim control. A mode declaration alone does not grant a caller that permission. Driver connectors use the same mode and risk vocabulary.

## Action checks

The screen transport captures frames and performs individual screen actions. It also reports local input where the transport supports detection. The computer-use driver resolves a declared target to a screen point. The controller is the component that authorizes each action against the active procedure.

Before acting, the controller checks the current bridge mode and control state. It inspects a fresh capture for the expected screen and ensures the selected point is outside forbidden regions. Local input since procedure start stops execution. The controller also checks its remaining step budget and deadline. Only declared steps and allowed keys can be executed.

The reference transport operates a Playwright page. Its reference computer-use driver follows scripted locators. The ports permit other transports, but the repository does not supply production VNC or RDP integration. No live grounding driver is provided.

## Control

`controlledBy` can be `operator`, `agent` or `idle`. The bridge refuses to act while an operator has control. Only a person can request operator control. Control remains assigned until an authorized command changes it; there is no automatic expiry.

An operator takeover changes the stored control state. Local input stops the current procedure where the transport detects it. Applications must decide how a lost operator session is recovered because control does not expire with that session.

## Observation

An extractor supplies a reading with confidence and provenance. Its metadata identifies the extractor and any model used, together with observation time and a frame digest. Field configuration specifies the required agreement across readings and minimum confidence.

A reading becomes current after the configured stable-read condition is met. A stable value below the confidence threshold creates an attention item. Operator confirmation or correction gives the value `operator-verified` provenance.

The accessibility recognizer uses deterministic extraction with confidence 1. A worker recognizer communicates with a local JSON-lines child process. The OpenAI-compatible vision recognizer validates fields against JSON Schema and confines its endpoint to loopback or the configured allowlist. Supported recognizer configuration is in `workstations/screen-bridge/src/recognition`.

## Station profiles

A station profile is versioned installation data. It identifies validated workstation-application versions and the screens the recognizer can identify. Fields specify their locator or screen region and extraction configuration. Procedures declare their preconditions and permitted steps, with the required readback and risk level. Forbidden regions exclude controls that the bridge must never operate.

Profile validation rejects undeclared fields and steps targeting a forbidden region. The golden test replays labelled captures and fails a confident wrong reading or incorrect screen classification. Run it after the workstation application or recognition model changes. Profile activation currently does not require a passing golden test.

## Automation route

A workstation with an automation interface can be reached through a [hardware driver](hardware-drivers.md). Its contract declares observable fields and allowed actions. The application's integration principal and grant still constrain effect delivery. The driver contract's `control` field identifies local operation, taking the place of screen-transport input detection for that route.

The application must bind the driver's declared actions and observations to its capabilities. A transport change does not itself establish compatible application semantics.

## Workstation sign-in

The [sign-in package](../workstations/sign-in/README.md) supplies badge-and-PIN sessions for a shared terminal. The operator enters a badge and a PIN of four to eight digits. An issued session authorizes subsequent calls as that operator.

A terminal is the local user or a principal configured in `station-sign-in-terminals`. It must use its own session to sign an operator in; a delegated grant is refused. A new sign-in ends the previous operator session. Session lifetime defaults to 15 minutes with a maximum of 720 minutes.

Five wrong PIN attempts lock the badge for 15 minutes. Unknown and revoked badges produce the same refusal as a wrong PIN. Stored state retains credential digests and a salted scrypt PIN hash. Badge and PIN values do not become stored command input.

Signing in does not transfer control from the bridge. An authorized takeover command is required. Physical badge-reader behavior remains unverified.

## Limits

The bridge is not safety-rated and must not operate safety functions. A deployment's forbidden regions must exclude those controls. Regulated use requires deployment-specific validation.

No physical computer-use integration is established by the scripted transport tests. The observer and profile tests check their configured extraction behavior; they do not establish correctness after an untested vendor update. Current evidence is recorded in [Implementation status](implementation-status.md#operator-workstation-bridge).

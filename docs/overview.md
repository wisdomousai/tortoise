# Overview

An operator records work in an [application](glossary.md#application), and the [host](glossary.md#host) commits that change to the application's [workspace](glossary.md#workspace). When another system must accept the result, a [dispatcher](glossary.md#dispatcher) delivers it after the local commit. Screens can show both the captured record and the external system's decision.

## Request path

In the [receiving](../showcase/examples/receiving/README.md) example, an operator counts a delivery line and then submits its goods receipt to the ERP. The count is already in the workspace when the operator submits. The submission follows this path:

<OverviewView view="request-path" />

1. The screen submits the goods-receipt [command](glossary.md#command) through the application's declared [capability](glossary.md#capability).
2. The [host](glossary.md#host) validates the input and derives the caller's identity and access from the session. The caller cannot choose a different workspace or widen that access through command arguments.
3. Inside the transaction, the runtime authorizes the operation, object and fields. The handler checks that the line has a count and that any discrepancy has a reason.
4. The transaction commits the line's pending posting and an [outbox effect](glossary.md#effect) to the [workspace](glossary.md#workspace). The effect holds the goods receipt to send. Revisions, the [command receipt](glossary.md#receipt) and journal entries commit in that transaction too.
5. The caller receives the command receipt. Open screens refetch the affected reads through their [live queries](glossary.md#live-query) and show the posting as pending.
6. The [dispatcher](glossary.md#dispatcher) sends the effect through the ERP target's [connector](glossary.md#connector), outside the transaction. In `receiving`, the connector writes a file to the bound exchange folder.
7. The file connector acknowledges the delivery and waits for the ERP's response. That acknowledgement is not acceptance.
8. The target's complete command records the ERP's acceptance or rejection in the workspace, and screens refresh again. If delivery is uncertain, the application holds the effect for a person to resolve.

A command submitted through HTTP, MCP or the CLI reaches the same handler and authorization checks as the screen's command. A [query](glossary.md#query) reads the records without changing them. The application declares both kinds of capability in its [catalog](glossary.md#catalog).

### Effect phases

A committed effect starts queued. A worker claims it for delivery; a transient failure can leave it retrying. If the target acknowledges receipt without a decision, the effect stays acknowledged while the dispatcher checks for the outcome. An uncertain outcome is held for a person rather than sent again automatically.

<OverviewView view="phases" />

## Data ownership

The ERP remains authoritative for master data and the postings it accepts. The application keeps [synced records](glossary.md#synced-records) of the delivery notices that receiving needs. It also keeps the counts, pending effects and delivery outcomes. [Inbound sync](glossary.md#inbound-sync) imports updates through commands. No transaction spans the application and the ERP.

The same path applies to an MES or a quality system. Input can come from an operator, a device or station software at the [point of work](glossary.md#point-of-work). The application keeps observed workstation state with its provenance ([operator workstations](operator-workstations.md#data-ownership)).

## Inputs

| Input | Route into a capability | Packages | Examples |
| --- | --- | --- | --- |
| Scanner | A scan route submits the command a button would. | [`packages/devices`](../packages/devices/README.md), [`plugins/intent-scanner`](../plugins/intent-scanner/README.md) | `winding-line`, `asset-survey-field` |
| Operator at a screen | Glove-sized parts of the operator registry call commands. | [`packages/operator-ui`](../packages/operator-ui/README.md) | `winding-line`, `quality-inspection` |
| Instrument or controller | A driver process reports readings and runs declared actions. | [`plugins/connector-driver`](../plugins/connector-driver/README.md), [`sdks/driver-python`](../sdks/driver-python/README.md), [`sdks/driver-dotnet`](../sdks/driver-dotnet/README.md) | `quality-inspection`, `winding-line` |
| Workstation application | The screen bridge reads the workstation application's screen and runs declared procedures. | [`workstations/screen-bridge`](../workstations/screen-bridge/README.md) | `winding-line` |
| Plant signals | MQTT, Sparkplug B or OPC UA readings pass the observation gate into an ingest command. | [`packages/observation`](../packages/observation/README.md), [`plugins/connector-mqtt`](../plugins/connector-mqtt/README.md), [`plugins/connector-opcua`](../plugins/connector-opcua/README.md) | `signals` pattern |
| Files | An inbox folder feeds inbound sync, and delivered files complete from receipt files. | [`plugins/connector-files`](../plugins/connector-files/README.md) | `receiving` |
| Phone | A paired phone takes [assignments](glossary.md#assignment) from its [hub](glossary.md#hub), captures offline and delivers the reports. | [`packages/mobile`](../packages/mobile/README.md), [`packages/assignments`](../packages/assignments/README.md), [`plugins/device-link`](../plugins/device-link/README.md), [`plugins/hub-link`](../plugins/hub-link/README.md) | `asset-survey-field` |
| Operating system | A link, file, share, Android intent, launcher shortcut or notification reply opens a screen or prefills a form that a person confirms. | [`packages/shell`](../packages/shell/README.md), [`plugins/os`](../plugins/os/README.md), [`plugins/share-target`](../plugins/share-target/README.md), [`plugins/os-shortcuts`](../plugins/os-shortcuts/README.md), [`plugins/android-intents`](../plugins/android-intents/README.md), [`plugins/notifications`](../plugins/notifications/README.md) | `field-service`, `asset-survey-field` |

## Operating properties

<OverviewView view="properties" />

## Layers and dependencies

<OverviewView view="layers" />

## Ports and plugins

The kernel takes each port from the one plugin that provides it, or uses the default.

<OverviewView view="ports" />

## Examples

A [deployment policy](glossary.md#deployment-policy) binds an application's destinations, child processes, devices and exchange folders. The host refuses access to resources the policy does not permit.

<OverviewView view="examples" />

## Limits

- Nothing in the framework is safety-rated. The screen bridge never talks to the PLC. A driver acts only through declared actions, under its [bridge mode](glossary.md#bridge-mode) and [risk level](glossary.md#risk-level).
- The MQTT and OPC UA connectors only read. Only the `signals` pattern composes them.
- The [execution host](glossary.md#execution-host) sandbox runs only on Linux with bubblewrap. No harness launches its tools through it yet ([agents](agents.md#limits)).
- The [egress guard](glossary.md#egress-guard) runs in the host process and does not contain other processes. Use the [generated rules](security-and-compliance.md#generated-rules) for them.
- One instance hosts one application. The framework does not synchronize a workspace across devices ([hosting](hosting.md)).
- Each storage transaction loads the whole workspace state ([scope](../README.md#scope)).

## References

- [Architecture](architecture.md)
- [Systems of record](systems-of-record.md)
- [Point-of-work input](point-of-work-input.md)
- [Operator workstations](operator-workstations.md)
- [Hardware drivers](hardware-drivers.md)
- [Security and compliance](security-and-compliance.md)
- [Mobile](mobile.md)

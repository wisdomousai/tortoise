# Overview

The framework builds applications that run at the [point of work](glossary.md#point-of-work): on a workstation PC, a site server or a phone next to the equipment. An application takes input from operators, scanners, instruments, plant signals and workstation applications, and commits each change to a local [workspace](glossary.md#workspace). The application delivers the changes to the [systems of record](glossary.md#system-of-record) that own the enterprise data, such as an ERP, an MES or a quality system. Each [capability](glossary.md#capability) is declared once and reached from the application's screens, HTTP, MCP and the CLI. The repository is a reference architecture.

## Concepts

Terms: [point of work](glossary.md#point-of-work), [working set](glossary.md#working-set), [operator](glossary.md#operator), [workstation](glossary.md#workstation), [target](glossary.md#target), [outbox effect](glossary.md#effect) and [deployment policy](glossary.md#deployment-policy).

## Data ownership

The system of record is authoritative for master data and for the postings it accepts. The application holds a working set: copies of the records a task needs, kept current by [inbound sync](glossary.md#inbound-sync). The application also holds the records it captured, its pending effects and their outcomes. Observed workstation state is held as copies with provenance ([operator workstations](operator-workstations.md#data-ownership)). No transaction spans the application and a system of record.

## Request path

<OverviewView view="request-path" />

A command takes this path:

1. An operator presses a button, a scanner reads a code, a driver reports a reading, or an observer reads a workstation application's screen.
2. A surface validates the input and derives the principal, the workspace and the grant from the session.
3. The runtime runs the handler and authorizes the operation, object and fields inside the transaction.
4. State, revisions, the receipt, journal entries and the outbox effect commit together, and the caller receives the receipt.
5. Every open screen whose reads changed refetches through its [live query](glossary.md#live-query).
6. The [dispatcher](glossary.md#dispatcher) delivers the effect outside any transaction, through the target's [connector](glossary.md#connector).
7. The system of record accepts the change, rejects it or acknowledges it without a decision.
8. A settle command records the outcome. An effect whose outcome nobody can tell is held for a person.

### Effect phases

An outbox effect is in one phase at a time.

<OverviewView view="phases" />

## Inputs

| Input | Route into a capability | Packages | Examples |
| --- | --- | --- | --- |
| Scanner | A scan route submits the command a button would. | [`packages/devices`](../packages/devices/README.md), [`plugins/intent-scanner`](../plugins/intent-scanner/README.md) | `line-station`, `asset-survey-field` |
| Operator at a screen | Glove-sized parts of the operator registry call commands. | [`packages/operator-ui`](../packages/operator-ui/README.md) | `line-station`, `quality-inspection` |
| Instrument or controller | A driver process reports readings and runs declared actions. | [`plugins/connector-driver`](../plugins/connector-driver/README.md), [`sdks/driver-python`](../sdks/driver-python/README.md), [`sdks/driver-dotnet`](../sdks/driver-dotnet/README.md) | `quality-inspection`, `line-station` |
| Workstation application | The screen bridge reads the workstation application's screen and runs declared procedures. | [`workstations/screen-bridge`](../workstations/screen-bridge/README.md) | `line-station` |
| Plant signals | MQTT, Sparkplug B or OPC UA readings pass the observation gate into an ingest command. | [`packages/observation`](../packages/observation/README.md), [`plugins/connector-mqtt`](../plugins/connector-mqtt/README.md), [`plugins/connector-opcua`](../plugins/connector-opcua/README.md) | None |
| Files | An inbox folder feeds inbound sync, and delivered files settle from receipt files. | [`plugins/connector-files`](../plugins/connector-files/README.md) | `receiving` |
| Phone | A paired phone takes [assignments](glossary.md#assignment) from its [hub](glossary.md#hub), captures offline and delivers the reports. | [`packages/mobile`](../packages/mobile/README.md), [`packages/assignments`](../packages/assignments/README.md), [`plugins/device-link`](../plugins/device-link/README.md), [`plugins/hub-link`](../plugins/hub-link/README.md) | `asset-survey-field` |

## Operating properties

<OverviewView view="properties" />

## Layers and dependencies

<OverviewView view="layers" />

## Ports and plugins

The kernel takes each port from the one plugin that provides it, or uses the default.

<OverviewView view="ports" />

## Examples

A [deployment policy](glossary.md#deployment-policy) binds the destinations, child processes, devices and exchange folders, and the host refuses the rest.

<OverviewView view="examples" />

## Limits

- Nothing in the framework is safety-rated. The screen bridge never talks to the PLC, and a driver acts only through declared actions under its [bridge mode](glossary.md#bridge-mode) and [hazard class](glossary.md#hazard-class).
- The MQTT and OPC UA connectors only read, and no example composes them.
- The [execution host](glossary.md#execution-host) sandbox runs only on Linux with bubblewrap, and no harness launches its tools through it yet ([agents](agents.md#limits)).
- The [egress guard](glossary.md#egress-guard) runs in the host process. Containing other processes needs the [generated rules](security-and-compliance.md#generated-rules).
- One instance hosts one application, and a workspace is not synchronized across devices ([hosting](hosting.md)).
- Each storage transaction loads the whole workspace state ([scope](../README.md#scope)).

## References

- [Architecture](architecture.md)
- [Systems of record](systems-of-record.md)
- [Point-of-work input](point-of-work-input.md)
- [Operator workstations](operator-workstations.md)
- [Hardware drivers](hardware-drivers.md)
- [Security and compliance](security-and-compliance.md)
- [Mobile](mobile.md)
- [Architecture](architecture.md#layers)
- [Invariants](architecture.md#invariants)
- [Architecture](architecture.md#ports)

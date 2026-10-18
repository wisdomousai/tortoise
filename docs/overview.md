# Overview

The framework builds applications that run at the [point of work](glossary.md#point-of-work): on a station PC, a site server or a phone next to the equipment. An application takes input from operators, scanners, instruments, plant signals and station software, and commits each change to a local [workspace](glossary.md#workspace). The application delivers the changes to the [systems of record](glossary.md#system-of-record) that own the enterprise data, such as an ERP, an MES or a quality system. Each [capability](glossary.md#capability) is declared once and reached from the application's screens, HTTP, MCP and the CLI. The repository is a reference architecture: the [framework](glossary.md#framework), [host plugins](glossary.md#host-plugin), a [starter](glossary.md#starter) and eight [examples](glossary.md#example).

## Concepts

Terms: [point of work](glossary.md#point-of-work), [working set](glossary.md#working-set), [operator](glossary.md#operator), [station](glossary.md#station), [target](glossary.md#target), [outbox effect](glossary.md#effect) and [site policy](glossary.md#site-policy).

## Data ownership

The system of record is authoritative for master data and for the postings it accepts. The application holds a working set: copies of the records a task needs, kept current by [inbound sync](glossary.md#inbound-sync). The application also holds the records it captured, its pending effects and their outcomes. Observed station state is held as copies with provenance ([operator workstations](operator-workstations.md#data-ownership)). No transaction spans the application and a system of record.

## Request path

The diagram shows three paths through the code: a command and its delivery, inbound sync, and a remote query. Each step names its code and the tests that prove it. The arrow keys move between steps while the diagram has focus.

<OverviewView view="request-path" />

A command takes this path:

1. An input arrives: a press on a screen, a scan, a driver reading or a reading of the station screen.
2. A surface validates the input and derives the principal, the workspace and the grant from the session.
3. The runtime runs the handler and authorizes the operation, object and fields inside the transaction.
4. State, revisions, the receipt, journal entries and the outbox effect commit together, and the caller receives the receipt.
5. Every open screen whose reads changed refetches through its [live query](glossary.md#live-query).
6. The [dispatcher](glossary.md#dispatcher) delivers the effect outside any transaction, through the target's [connector](glossary.md#connector).
7. The system of record accepts the change, rejects it or acknowledges it without a decision.
8. A settle command records the outcome. An effect whose outcome nobody can tell is held for a person.

[Systems of record](systems-of-record.md) explains the outbox, inbound sync and remote queries.

### Effect phases

An outbox effect is in one phase at a time. Selecting a phase lists the transitions into and out of it.

<OverviewView view="phases" />

## Inputs

| Input | Route into a capability | Packages | Examples |
| --- | --- | --- | --- |
| Scanner | A scan route submits the command a button would. | [`packages/devices`](../packages/devices/README.md), [`plugins/intent-scanner`](../plugins/intent-scanner/README.md) | `line-station`, `asset-survey-field` |
| Operator at a screen | Glove-sized parts of the operator registry call commands. | [`packages/operator-ui`](../packages/operator-ui/README.md) | `line-station`, `quality-inspection` |
| Instrument or controller | A driver process reports readings and runs declared actions. | [`plugins/connector-driver`](../plugins/connector-driver/README.md), [`sdks/driver-python`](../sdks/driver-python/README.md), [`sdks/driver-dotnet`](../sdks/driver-dotnet/README.md) | `quality-inspection`, `line-station` |
| Station software | The screen bridge reads the station screen and runs declared procedures. | [`packages/station`](../packages/station/README.md) | `line-station` |
| Plant signals | MQTT, Sparkplug B or OPC UA readings pass the observation gate into an ingest command. | [`packages/observation`](../packages/observation/README.md), [`plugins/connector-mqtt`](../plugins/connector-mqtt/README.md), [`plugins/connector-opcua`](../plugins/connector-opcua/README.md) | None |
| Files | An inbox folder feeds inbound sync, and delivered files settle from receipt files. | [`plugins/connector-files`](../plugins/connector-files/README.md) | `receiving` |
| Phone | A paired phone captures offline and delivers to its [hub](glossary.md#hub). | [`packages/mobile`](../packages/mobile/README.md), [`plugins/device-link`](../plugins/device-link/README.md), [`plugins/hub-link`](../plugins/hub-link/README.md) | `asset-survey-field` |

[Point-of-work input](point-of-work-input.md), [operator workstations](operator-workstations.md) and [hardware drivers](hardware-drivers.md) describe the routes.

## Operating properties

Each property names the tests that prove it.

<OverviewView view="properties" />

## Layers and dependencies

Selecting a workspace marks its framework dependencies and the workspaces that depend on it. [Architecture](architecture.md#layers) describes the layers, and its [invariants](architecture.md#invariants) list the import rules.

<OverviewView view="layers" />

## Ports and plugins

The kernel takes each port from the one plugin that provides it, or uses the default. [Architecture](architecture.md#ports) explains the ports and the composition rules.

<OverviewView view="ports" />

## Examples

Each example's declarations come from its security manifest. A [site policy](glossary.md#site-policy) binds the destinations, child processes, devices and exchange folders, and the host refuses the rest.

<OverviewView view="examples" />

## Generated data

`bun run generate` writes `dist/reference/overview.json` from the workspace manifests, the READMEs, the application manifests and their catalogs. The request paths, properties, port table and example routes come from `scripts/overview-curated.ts`. The generator checks every file, test name and guide heading those entries name, so `bun run check` fails on a stale entry. `bun run docs:dev` and `bun run docs:build` run the generator first.

```sh
bun run generate
bun run docs:dev
```

## Limits

- Nothing in the framework is safety-rated. The screen bridge never talks to the PLC, and a driver acts only through declared actions under its [bridge mode](glossary.md#bridge-mode) and [hazard class](glossary.md#hazard-class).
- The MQTT and OPC UA connectors only read, and no example composes them.
- The [execution host](glossary.md#execution-host) sandbox runs only on Linux with bubblewrap, and no harness launches its tools through it yet ([agents](agents.md#limits)).
- The [egress guard](glossary.md#egress-guard) runs in the host process. Containing other processes needs the [generated rules](security-and-compliance.md#generated-rules).
- One authority hosts one application, and a workspace is not synchronized across devices ([hosting](hosting.md)).
- Each storage transaction loads the whole workspace state ([scope](../README.md#scope)).

## Related pages

- [Architecture](architecture.md): layers, surfaces, request flow, hosts, plugins and the invariants.
- [Systems of record](systems-of-record.md): the outbox, inbound sync, remote queries and connectors.
- [Point-of-work input](point-of-work-input.md) and [operator workstations](operator-workstations.md): scanners, glove-sized screens and station software.
- [Hardware drivers](hardware-drivers.md): equipment reached through a driver process.
- [Security and compliance](security-and-compliance.md): site policy, egress, the audit log and isolated operation.
- [Mobile](mobile.md): the mobile host and pairing with a hub.

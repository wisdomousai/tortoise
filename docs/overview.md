# Overview

An application fits one step of a site's work and runs on the computer or phone at that step. The host is the process that runs it. People use its screens, agents call its CLI or MCP server, and scripts call its HTTP API. All of them reach the same instance.

The instance holds a workspace — by default a SQLite database in a directory. Every change to a record is a command. The host validates input, checks access and commits. No other process writes the workspace while the instance is open.

## How a change reaches the central system

The `receiving` example does goods receiving against an ERP that exchanges files through shared folders.

1. The ERP writes advance shipping notices into `erp-asn`. The application imports each line.
2. A receiver counts a line at the dock and enters the count on screen. The screen runs `delivery.receive`.
3. When the count differs from the notice, the `receiving.discrepancy` agent proposes a reason. The receiver approves or rejects it.
4. The receiver posts the line (`erp.send`). The host checks access, then commits the change and an outbox entry for the ERP in one transaction.
5. The dispatcher writes the goods receipt as a file into `erp-goods-receipts`. The ERP answers with a receipt file in `erp-receipts`.
6. Open screens refresh after each commit. The audit log has an entry for each command.

The same pattern applies to an MES, a quality system or any other system of record. Commit locally first, then deliver.

## Outbox phases

A committed effect starts **queued**. The dispatcher claims it for delivery.

- **Retrying** — a transient failure; the dispatcher tries again
- **Acknowledged** — the system of record has the delivery but has not decided yet
- **Complete** — accepted or rejected
- **Held** — the outcome is uncertain; a person resolves it instead of resending

<OverviewView view="phases" />

## Inputs

| Input | How it reaches the application |
| --- | --- |
| Screen | A person enters data; the screen runs a command |
| Scanner | A scan route runs the command a button would |
| Instrument or controller | A driver process reports readings and runs declared actions |
| Workstation application | The screen bridge reads the station screen and runs procedures |
| Plant signals | MQTT, Sparkplug B or OPC UA readings pass an observation gate into a command |
| Files | An inbox folder feeds inbound sync; delivery files complete effects |
| Phone | A paired phone takes assignments, captures offline, delivers reports |
| OS integration | Links, shares, intents, shortcuts and notification replies open screens or prefill forms |

## Layers

<OverviewView view="layers" />

## Ports and plugins

The kernel takes each port from the one plugin that provides it, or uses the default.

<OverviewView view="ports" />

## Examples

A deployment policy binds destinations, processes, devices and exchange folders. The host refuses anything the policy does not list.

<OverviewView view="examples" />

## Limits

- Nothing in the framework is safety-rated. The screen bridge never talks to the PLC.
- A driver acts only through declared actions, under its bridge mode and risk level.
- MQTT and OPC UA connectors only read. Only the `signals` pattern composes them.
- The execution host sandbox runs only on Linux with bubblewrap. No harness uses it yet.
- The egress guard runs in the host process and does not contain other processes.
- One instance hosts one application.
- Each storage transaction loads the whole workspace state.

## References

- [Architecture](architecture.md)
- [Systems of record](systems-of-record.md)
- [Operator workstations](operator-workstations.md)
- [Hardware drivers](hardware-drivers.md)
- [Security and compliance](security-and-compliance.md)
- [Mobile](mobile.md)

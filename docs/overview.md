# Overview

An application serves one specialized business process and runs at the edge, on a computer or phone. The host runs it. People use its screens, agents call its CLI or MCP server, and scripts call its HTTP API. All of them reach the same instance.

Each instance has one workspace, by default a SQLite database in a directory. Every change to a record is a command. The host validates input, checks access and commits. No other process writes the workspace while the instance is open.

## How a change reaches the central system

1. Inbound sync imports what the application needs from the central system, such as orders or master data, as ordinary commands.
2. A person on a screen, an agent over MCP or the CLI, a scanner or a device runs a command. The host validates the input, checks access to the operation, the record and its fields, and commits.
3. When an agent runs a command that needs a person, the command waits as an approval request until a person approves or rejects it.
4. A command whose result belongs in the central system commits its change and an effect in the outbox in one transaction.
5. After the commit, the dispatcher delivers the effect through the target for that system: an HTTP API, a file in an exchange folder or a peer application. The central system accepts or rejects it, and the target's complete command records that outcome.
6. Open screens refresh after each commit. The audit log has an entry for each command.

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
| Files | An inbox folder supplies inbound sync; delivery files complete effects |
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
- The network guard runs in the host process and does not contain other processes.
- One instance hosts one application.
- Each storage transaction loads the whole workspace state.

## References

- [Architecture](architecture.md)
- [Systems of record](systems-of-record.md)
- [Operator workstations](operator-workstations.md)
- [Hardware drivers](hardware-drivers.md)
- [Security and compliance](security-and-compliance.md)
- [Mobile](mobile.md)

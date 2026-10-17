# @agent-native/telemetry

OpenTelemetry metrics and traces for an authority: commands by outcome, outbox delivery time and attempts, the outbox backlog by target, and agent and job runs by end state. The plugin derives them from the audit plugin's log and the outbox and posts them as OTLP/HTTP JSON to a collector on the same machine, through the network port, so the egress guard binds, limits and logs every export. No record contents, inputs, principals or resource IDs are exported.

Layer: plugins (`plugins/*`). Server only. [Telemetry](../../docs/primitives.md#telemetry) in the primitives index.

## Wiring

Compose `telemetryPluginManifest` in the manifest's `plugins` and `telemetryPlugin` (or `createTelemetryPlugin(options)`) in the application's `plugins`, after the site, network and audit plugins. Startup refuses an application without the audit plugin before it, or without a provided network port.

The site policy binds the `telemetry` destination to the collector's OTLP/HTTP address, for example `"destinations": { "telemetry": { "url": "http://127.0.0.1:4318" } }`. The destination is loopback and plain http: run an [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/) next to the authority and let it hold any vendor credential and forward the data on. Unbound, the plugin exports nothing and says why in `status().lastError`.

| Option | Default | Meaning |
| --- | --- | --- |
| `intervalMs` | 60,000 | between exports |
| `maxSpans` | 2,048 | spans kept while the collector is unreachable; the oldest are dropped past this |
| `maxOpen` | 10,000 | commands and effects remembered while their end is pending |

The service at `services.telemetry` offers `status()` (audit position, exports, last error, dropped spans) and `flush()`, which reads the log to its head and exports now.

## What is exported

| Metric | Kind | Attributes |
| --- | --- | --- |
| `agent_native.commands` | counter | `agent_native.operation`, `agent_native.outcome` (committed, replayed, recovered, aborted, failed, denied), `agent_native.channel`, `error.type` |
| `agent_native.command.duration` | histogram, ms | operation and outcome; from `command.accepted` to the outcome |
| `agent_native.deliveries` | counter | `agent_native.target`, `agent_native.effect.status` (accepted, rejected, cancelled) |
| `agent_native.delivery.duration` | histogram, ms | target and status; from the committing command to settlement |
| `agent_native.delivery.attempts` | counter | target, `agent_native.attempt.result` (retry, held, upstream, superseded) |
| `agent_native.outbox.backlog` | gauge | target, `agent_native.outbox.state` (pending, held, upstream) |
| `agent_native.runs` | counter | `agent_native.harness`, `agent_native.run.state`, `error.type` |
| `agent_native.run.duration` | histogram, ms | harness and state; from queued to ended |

Spans: one per command, named by its operation; one per settled delivery (`deliver <target>`), a child of the command that enqueued it; and one per run (`run`), the parent of the commands the run issued. Trace and span IDs are SHA-256 digests of correlation, effect and run IDs. The resource carries `service.name` (the application ID) and `service.instance.id`.

## Contents

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/telemetry/plugin-manifest` | browser-safe | `telemetryPluginManifest`, `telemetryExportComponent` and its `telemetry` destination |
| `@agent-native/telemetry/plugin` | server | `createTelemetryPlugin`, `telemetryPlugin`, the service and status types |
| `@agent-native/telemetry/recorder` | server | `createRecorder`: audit events to cumulative metrics and finished spans |
| `@agent-native/telemetry/otlp` | server | `metricsRequest` and `tracesRequest`, the OTLP/HTTP JSON bodies |

## Trust boundary

- **Only identifiers leave.** Attribute values are catalog operation IDs, outbox target IDs, harness IDs, fixed states and upper-case error codes; anything else becomes `unknown` or `OTHER`. The recorder never reads an event's `resources`, `inputDigest` or principal, and from `data` only the effect ID, target and status and the run's harness, state and duration. Correlation, effect and run IDs appear only as digests.
- **Exports go through the egress guard.** The plugin reaches the collector only through the network port's `telemetry` client, which resolves the path against the bound origin, refuses redirects and records each connection in the audit log.
- **Nothing waits on the collector.** The plugin writes nothing to the workspace. An export that fails records the reason and the next one tries again. Metrics are cumulative since start, so a missed export loses resolution, not counts; spans wait in a bounded buffer.
- **Counts begin when the host starts.** The plugin follows the audit log from its head when the host starts and seeds delivery times from the effects pending then. Earlier history stays in the audit log; a restart resets the counters, which OTLP's start time tells the collector.

Limits: each export rereads the log's segment files to find the new events, so a very long log makes exports slower. One host instance exports one workspace. There are no logs, only metrics and traces.

## Tests

```sh
bun test plugins/telemetry
```

`test/telemetry.test.ts` starts an authority with the site, network, audit and telemetry plugins and a loopback collector bound in its site policy. It checks the command, delivery, attempt, backlog and run metrics, the parent links between command, delivery and run spans, that no note text, resource, principal, run, effect or correlation ID reaches the collector, and that each export is a guarded connection in the audit log. It also covers a collector that is down (counts survive and spans are dropped past the buffer) and an authority with no collector bound.

## Skills

- [export-telemetry](skills/export-telemetry/SKILL.md): composing the plugin, binding a collector, and adding a metric.

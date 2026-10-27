# @agent-native/telemetry

The [telemetry](../../docs/glossary.md#telemetry) [host plugin](../../docs/glossary.md#host-plugin). It derives OpenTelemetry metrics and traces for an [instance](../../docs/glossary.md#instance) from the audit plugin's log and the [outbox](../../docs/glossary.md#outbox). It posts them as OTLP/HTTP JSON to a collector on the same machine, through the network port, so the [egress guard](../../docs/glossary.md#egress-guard) binds, limits and logs every export.

No record contents, inputs, principals or resource IDs are exported.

## Layer

Plugins (`plugins/*`). Server only. The plugin trusts the audit plugin's log as its only source of events, and the network port as its only path to the collector.

## Primitives

- [Telemetry](../../docs/primitives.md#telemetry): `createTelemetryPlugin`, `telemetryPlugin`, the recorder and the OTLP encoders.
- [Requirement declaration](../../docs/primitives.md#requirement-declaration): `telemetryExportComponent` declares the `telemetry` destination (loopback, HTTP, `telemetry` data).
- [Host plugin](../../docs/primitives.md#host-plugin): `telemetryPlugin` and `telemetryPluginManifest`, with the service at `services.telemetry`.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/telemetry/plugin-manifest` | browser-safe | `telemetryPluginManifest`, `telemetryExportComponent` and its `telemetry` destination |
| `@agent-native/telemetry/plugin` | server | `createTelemetryPlugin`, `telemetryPlugin`, the service and status types |
| `@agent-native/telemetry/recorder` | server | `createRecorder`: audit events to cumulative metrics and finished spans |
| `@agent-native/telemetry/otlp` | server | `metricsRequest` and `tracesRequest`, the OTLP/HTTP JSON bodies |
| `@agent-native/telemetry/testing` | server (tests and development) | `startCollector`, an OTLP/HTTP collector stand-in on loopback that keeps the newest 1,000 requests and can answer 503 |

### Composition

Compose `telemetryPluginManifest` in the manifest's `plugins`. Compose `telemetryPlugin`, or `createTelemetryPlugin(options)`, in the application's `plugins`. Both go after the site, network and audit plugins. Startup refuses an application without the audit plugin before it, or without a provided network port.

The [deployment policy](../../docs/glossary.md#deployment-policy) binds the `telemetry` destination to the collector's OTLP/HTTP address, for example `"destinations": { "telemetry": { "url": "http://127.0.0.1:4318" } }`. The destination is loopback and plain HTTP. Run an [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/) next to the instance, and let it hold any vendor credential and forward the data on. While the destination is unbound, the plugin exports nothing and says why in `status().lastError`.

| Option | Default | Meaning |
| --- | --- | --- |
| `intervalMs` | 60,000 | between exports |
| `maxSpans` | 2,048 | spans kept while the collector is unreachable; the oldest are dropped past this |
| `maxOpen` | 10,000 | commands and effects remembered while their end is pending |

The service at `services.telemetry` offers `status()` and `flush()`. `status()` reports the audit position, exports, the last error and dropped spans. `flush()` reads the log to its head and exports now.

## Trust boundary

### Metrics

| Metric | Kind | Attributes |
| --- | --- | --- |
| `agent_native.commands` | counter | `agent_native.operation`, `agent_native.outcome` (committed, replayed, recovered, aborted, failed, denied), `agent_native.channel`, `error.type` |
| `agent_native.command.duration` | histogram, ms | operation ID and outcome; from `command.accepted` to the outcome |
| `agent_native.deliveries` | counter | `agent_native.target`, `agent_native.effect.status` (accepted, rejected, cancelled) |
| `agent_native.delivery.duration` | histogram, ms | target and status; from the committing command to settlement |
| `agent_native.delivery.attempts` | counter | target, `agent_native.attempt.result` (retry, held, upstream, superseded) |
| `agent_native.outbox.backlog` | gauge | target, `agent_native.outbox.state` (pending, held, upstream) |
| `agent_native.runs` | counter | `agent_native.harness`, `agent_native.run.state`, `error.type` |
| `agent_native.run.duration` | histogram, ms | harness and state; from queued to ended |

### Spans

The plugin emits:

- one span per command, named by its operation ID;
- one span per settled delivery (`deliver <target>`), a child of the command that enqueued it;
- one span per run (`run`), the parent of the commands the run issued.

Trace and span IDs are SHA-256 digests of correlation, effect and run IDs. The resource carries `service.name`, which is the application ID, and `service.instance.id`.

### Data rules

- **Identifiers only.** Attribute values are operation IDs from the catalog, outbox target IDs, harness IDs, fixed states and upper-case error codes. Anything else becomes `unknown` or `OTHER`.
- **Fields read.** The recorder never reads an event's `resources`, `inputDigest` or principal. From `data` it reads only the effect ID, target and status, and the run's harness, state and duration.
- **Digests.** Correlation, effect and run IDs appear only as digests.
- **Egress guard.** The plugin reaches the collector only through the network port's `telemetry` client. The client resolves the path against the bound origin, refuses redirects and records each connection in the [audit log](../../docs/glossary.md#audit-log).
- **No waiting on the collector.** The plugin writes nothing to the workspace. A failed export records the reason, and the next export tries again.
- **Cumulative metrics.** Metrics are cumulative since start, so a missed export loses resolution but no counts. Spans wait in a bounded buffer.
- **Start of counting.** The plugin follows the audit log from its head when the host starts, and seeds delivery times from the effects pending then. Earlier history stays in the audit log.
- **Restarts.** A restart resets the counters, and the OTLP start time tells the collector so.

### Limits

Each export rereads the log's segment files to find the new events, so a very long log makes exports slower. One host instance exports one workspace. The plugin exports metrics and traces and no logs.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/event-log` (`readEvents`), `@agent-native/host` (`plugin`, `plugin-manifest`) and `@agent-native/kernel` (`application`). Plugin: `@agent-native/audit`. No external packages.

The tests also use `@agent-native/runtime`, `@agent-native/site`, `@agent-native/network` and `zod`.

## Tests

```sh
bun test plugins/telemetry
```

`test/telemetry.test.ts` starts an instance with the site, network, audit and telemetry plugins and the `startCollector` stand-in bound in its deployment policy. It checks:

- the command, delivery, attempt, backlog and run metrics;
- the parent links between command, delivery and run spans;
- that no record text, resource, principal, run, effect or correlation ID reaches the collector;
- that each export is a guarded connection in the audit log;
- a collector that is down, with counts kept and spans dropped past the buffer;
- an instance with no collector bound.

## Skills

- [export-telemetry](skills/export-telemetry/SKILL.md): composing the plugin, binding a collector, and adding a metric.

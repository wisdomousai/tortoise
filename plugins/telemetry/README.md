# @tortoise/telemetry

`@tortoise/telemetry` exports measurements derived from runtime audit events and outbox state. `createTelemetryPlugin` sends OTLP/HTTP JSON through a destination bound to a collector on the same machine.

Exported resources identify the application and instance. Trace identifiers are derived from runtime correlation identifiers, and measurements exclude record contents. `startCollector` provides a fixture for checking the exporter without an external collector.

## References

[export-telemetry](skills/export-telemetry/SKILL.md)

`bun test plugins/telemetry`

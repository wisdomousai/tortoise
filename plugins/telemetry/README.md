# @agent-native/telemetry

Derives OpenTelemetry metrics and traces from the audit log and the outbox and posts them as OTLP/HTTP JSON to a collector on the same machine. Compose `createTelemetryPlugin`; `startCollector` runs a stand-in for tests. Trace and span IDs are SHA-256 digests of correlation, effect and run IDs, and the resource has `service.name` (the application ID) and `service.instance.id`.

Primitives:

- [Telemetry](../../docs/primitives.md#telemetry)
- [Requirement declaration](../../docs/primitives.md#requirement-declaration)
- [Host plugin](../../docs/primitives.md#host-plugin)

## References

- [export-telemetry](skills/export-telemetry/SKILL.md)
- `bun test plugins/telemetry`

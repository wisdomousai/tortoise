---
name: export-telemetry
description: Export OpenTelemetry metrics and traces from an agent-native instance. Use when composing the telemetry plugin, binding the telemetry destination to an OpenTelemetry Collector in a deployment policy, reading command, delivery, backlog and run metrics in an observability backend, or adding a metric or span attribute without exporting record contents. Covers plugins/telemetry.
---

# Export telemetry

The telemetry plugin turns the audit log and the outbox into OpenTelemetry metrics and spans. It posts them as OTLP/HTTP JSON through the network guard.

## Before writing

- A metric comes from audit events or the outbox, never from workspace state or handler code.
- An attribute value must be a catalog or outbox identifier, a fixed state or an error code.

## Steps

### Export

1. Add `telemetryPluginManifest` to the manifest's `plugins`, after the site, network and audit plugins.
2. Add `telemetryPlugin`, or `createTelemetryPlugin({ intervalMs })`, to the application's `plugins` in the same order. `showcase/patterns/operations/application.ts` composes all four.
3. Run a collector on the same machine with an OTLP/HTTP receiver, for example on `127.0.0.1:4318`. The collector stores any vendor credential and forwards to the backend; the instance never does. In tests and development, `startCollector` from `@tortoise/telemetry/testing` stands in for it on loopback. `showcase/patterns/operations/dev.ts` starts it on port 4318 when nothing listens there.
4. Bind `destinations.telemetry` to the collector's address in the deployment policy. The `deploy-to-site` skill (`plugins/site/skills/deploy-to-site/SKILL.md`) covers the policy. Without the binding, the instance runs without exporting.
5. Read `services.telemetry.status()`. `exports` counts successful exports, and `lastError` says why the last one failed.

### New metric

1. Add the metric in `src/recorder.ts`.
2. Add its encoding in `src/otlp.ts`.
3. Pass free values through `identifier` or `code`, so nothing from a record reaches an attribute.
4. When the audit event you need does not exist, emit it where the framework emits its other audit events. That is `packages/runtime/src/application/audit.ts`, or `runAuditRecord` in `packages/agents` for runs.
5. List the new event's kind in `auditEventKinds`.

## Checks

1. Extend `test/telemetry.test.ts` with the new metric, and keep its leak check passing. The test reads what `startCollector` received.
2. Run the tests:

   ```sh
   bun test plugins/telemetry
   ```

3. Record a run against a real collector and backend as by-hand evidence in [implementation status](../../../../docs/implementation-status.md#telemetry).
4. Follow the `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`) for the rest.

## References

- [Architecture](../../../../docs/architecture.md#telemetry)
- [`@tortoise/telemetry`](../../README.md)
- [Operations pattern](../../../../showcase/patterns/operations/README.md)

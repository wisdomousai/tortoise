---
name: export-telemetry
description: Export OpenTelemetry metrics and traces from an agent-native authority. Use when composing the telemetry plugin, binding the telemetry destination to an OpenTelemetry Collector in a site policy, reading command, delivery, backlog and run metrics in an observability backend, or adding a metric or span attribute without exporting record contents. Covers plugins/telemetry.
---

# Export telemetry

The telemetry plugin turns the audit log and the outbox into OpenTelemetry metrics and spans and posts them as OTLP/HTTP JSON through the egress guard. The [README](../../README.md) lists every metric, attribute and span and states what may leave.

## Steps

1. **Compose** `telemetryPluginManifest` in the manifest's `plugins` and `telemetryPlugin` (or `createTelemetryPlugin({ intervalMs })`) in the application's `plugins`, after the site, network and audit plugins.
2. **Run a collector** on the same machine with an OTLP/HTTP receiver, for example on `127.0.0.1:4318`. The collector holds any vendor credential and forwards to the backend; the authority never does.
3. **Bind** `destinations.telemetry` to the collector's address in the site policy (the `deploy-to-site` skill, `plugins/site/skills/deploy-to-site/SKILL.md`). Leave it out and the authority runs without exporting.
4. **Check** with `services.telemetry.status()`: `exports` counts successful exports and `lastError` says why the last one failed.

## Adding a metric

A metric comes from audit events or the outbox, never from workspace state or handler code. Add it in `src/recorder.ts` and its encoding in `src/otlp.ts`. An attribute value must be a catalog or outbox identifier, a fixed state or an error code; pass free values through `identifier` or `code` so nothing from a record reaches it. If the event you need does not exist, emit it where the framework emits its other audit events (`packages/runtime/src/application/audit.ts`, or `runAuditRecord` in `packages/agents` for runs) and list its kind in `auditEventKinds`.

## Checks

```sh
bun test plugins/telemetry
```

Extend `test/telemetry.test.ts` with the new metric and keep its leak check passing. A run against a real collector and backend is by-hand evidence for `docs/implementation-status.md`. The `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`) covers the rest.

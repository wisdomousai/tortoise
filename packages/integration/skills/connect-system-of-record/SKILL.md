---
name: connect-system-of-record
description: Connect an application to an external system through a declared target. Use for writes requiring external acceptance, inbound synchronization, on-demand remote reads or connector implementation.
---

# Connect a system of record

Define the external behavior required by the application before choosing a connector. Determine which system owns the affected records and what establishes acceptance. A successful local command establishes its transaction's commit. External acceptance is recorded later through the target's completion operation.

## Target contract

Declare the target with `defineTarget` in browser-safe contracts. It generates a completion command and status query. Include `inbound` only when the application needs synchronization; that declaration adds the sync command.

Declare the destination used by the connector, or its exchange folders through `fileExchange` from `@tortoise/connector-files/contracts`. Each requirement must be bound by the deployment policy. Shared folders use the folder port. Network delivery uses the network port.

Use `targetHandlers` for completion and inbound application hooks. The completion hook decides how an outcome changes application records. The inbound hook controls which fields incoming items may change. Configure `versions` when an older item can arrive after a newer one.

`targetRules` makes completion and sync integration-only. Status remains subject to the policy's caller gate, and its handler must scope counts to the caller. Use the target's generated allowlist and context for its integration principal. Do not widen that principal's grant to application commands unrelated to integration.

## Application writes

A command requiring external delivery calls `ctx.enqueue` on a resource it changes and declares its `integration`. The application decides where to keep any effect reference or delivery state. The transaction must not call the external system.

`scaffold add target <name> --collection <type>` generates a send operation and its supporting state. If the required effect belongs inside an existing operation, move the enqueue into that operation and remove the generated send path and unused delivery state. Review the resulting policy and bindings.

Connect the declaration to its port through `connectTarget` in `application.ts`. A target without inbound synchronization performs delivery only. The host manages the returned workers through its lifecycle.

## Connector behavior

Implement `SystemOfRecordPort` or configure an existing connector. The HTTP connector supplies `httpTargetPort` for request mappings and rejection rules. The file connector supplies `fileTargetPort` for exchange folders and receipt lookup. Their READMEs specify their configuration contracts.

Delivery must be idempotent by effect ID or provide lookup before redelivery. Return a business rejection as delivery data. Return `pending` when the external system acknowledged the request but has not decided. A transient failure can be retried; throw `DeliveryUncertain` when the connector may have acted and cannot determine the outcome through lookup.

Mount `reconciliationFeature()` with `reconciliationFeatureManifest` and an application-supplied access view. Use [write-a-feature](../../../host/skills/write-a-feature/SKILL.md) for the composition. Its `allows` check must enforce membership and integration scope, while `sees` limits the effects the caller can inspect. Bind the `reconciliation-review` registry component to a screen.

A held effect needs an authorized person's resolution. The feature can record that the effect was applied or refused, or release it for delivery when it was not applied. Its `onResolved` hook updates the application record in the same transaction. Use a separate domain command only when the required decision has additional application behavior. A dispatch authorization refusal can hold an effect before any external action, so uncertainty is not the only reason to inspect it.

## Remote reads and other targets

For on-demand reads, declare a data provider and implement it with `implementDataProvider` backed by `createRemoteSource`. Configure caller-credential behavior explicitly. A service-identity declaration uses the service credential; it must not silently widen a caller's source access. Persisting or following a remote result needs the application's own command and retention behavior.

For another Tortoise application, follow [connect-two-applications](../../../../plugins/peer-link/skills/connect-two-applications/SKILL.md). It covers the peer API and enrollment, with `definePeerTarget`, peer delivery and source drift handling. Screen-operated systems use [bridge-station-screen](../../../../workstations/screen-bridge/skills/bridge-station-screen/SKILL.md). Equipment actions follow [write-hardware-driver](../../../../plugins/connector-driver/skills/write-hardware-driver/SKILL.md).

## Checks

Run `connectorConformance` from `@tortoise/testing/connectors` against the port. The application tests must check its own outcome hooks, including a lost reply and an external rejection. Exercise held-effect resolution under permitted and refused callers. Inbound tests need a stale watermark and, when versions are configured, an older item arriving late.

```sh
bun run test:integration
bun test showcase/examples/<app>
bun run generate
```

Review generated security manifests for declared destinations, including those inherited by a nested invocation. Keep real-system execution evidence separate from connector fixtures in [Implementation status](../../../../docs/implementation-status.md). [Systems of record](../../../../docs/systems-of-record.md) defines delivery and synchronization semantics.

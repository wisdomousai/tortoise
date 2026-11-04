---
name: connect-system-of-record
description: Connect an agent-native application to another system that keeps its own records (ERP, QMS, CRM, EAM, a peer host). Use when a command's write must be accepted by that system, when master data must be pulled in, when a screen or agent needs a live search over it, or when writing or testing a SystemOfRecordPort. Covers defineTarget, outbox effects and completion, held and acknowledged effects, inbound sync, remote sources and data providers in packages/integration and showcase/examples/<app>/contracts/target.ts.
---

# Connect a system of record

The application owns its synced records and its pending outbox effects. A local command result proves the local commit, not acceptance by the target.

## Before writing

- Write down the trigger, the record each side owns and who handles an exception.
- List the outcomes the target can return: accepted, rejected or acknowledged to be decided later.
- Decide how the target deduplicates: by effect ID (idempotent delivery) or through a lookup the dispatcher calls before every send. With neither, design the reconciliation path before the happy path.
- Decide whether reads use records copied through inbound sync or read the system of record when asked through a remote query. Do not copy a whole system to serve searches.

## Steps

1. Declare the target once with `defineTarget` in the browser-safe contracts (`showcase/examples/quality-inspection/contracts/target.ts`). It produces the complete, sync and status capabilities, the integration principal's grant and its integration allowlist.
2. Declare how the application reaches the target:
   - a network destination that reads the target and queues while offline;
   - or, for a system reached through shared folders, the exchange folders with `fileExchange` from `@tortoise/connector-files/contracts`.
3. Enqueue in commands. A command that forwards a record calls `ctx.enqueue` on a changed resource and declares `integration` on the capability. The record keeps its effect ID and delivery state. Never call the target inside a handler. When an existing command forwards the record, such as a return that sends a repair order, delete the send command and delivery map that `scaffold add target` generated.
4. Implement the complete and sync handlers with `targetHandlers`. They say how an outcome changes the forwarded record, how an inbound item changes local state, and which records a caller may count.
5. Pass `versions` to `targetHandlers` when inbound sync can deliver an older version after a newer one.
6. Implement the connector (`SystemOfRecordPort`) as the only code that talks to the target. It reaches the target through the network port or the folder port. Start from a ready-made port when one fits:
   - `httpTargetPort` (`plugins/connector-http`) for a REST system, with requests and rejection rules as data. `showcase/patterns/system-of-record/lims-port.ts` adds a pending status, a lookup and inbound sync;
   - `fileTargetPort` (`plugins/connector-files`) for a file drop with receipts or an archive, and an inbox of result exports.
7. Return a business rejection as data, `DeliveryUncertain` when the outcome cannot be established, and `pending` when the target acknowledged but has not decided. For a target whose delivery is not idempotent, the dispatcher calls `lookup` before each redelivery, so a lost reply can be thrown as a transient failure; throw `DeliveryUncertain` when the connector may already have acted and its lookup cannot tell.
8. Connect the target in `application.ts` with `connectTarget` (`showcase/examples/quality-inspection/application.ts`). A target without inbound sync only delivers.
9. Compose reconciliation for held effects. The dispatcher puts an effect in `held` when its outcome cannot be established, its acknowledgement was lost or its recheck was denied. It polls `acknowledged` effects. Only a domain command moves an effect out of `held`: complete it when the target applied or refused it, release it when it did not.
   - Mount `reconciliationFeature()` from `@tortoise/runtime`: list `reconciliationFeatureManifest` in `defineManifest({ features })` and mount it with `mountFeature` in `application.ts`, as `showcase/examples/receiving/application.ts` does and the `write-a-feature` skill (`packages/host/skills/write-a-feature/SKILL.md`) describes.
   - In the access view, `allows(context, action)` applies the application's membership gate and integration allowlists, and `sees(context, effect)` decides which held effects a caller may see and decide.
   - Add the frame's `reconciliation-review` UI registry item to a screen.
   - In the `onResolved` hook, record the outcome on the domain record as the target's `onOutcome` would. It receives the application's handler context last and commits with the decision.
10. Write a domain command of your own for a held effect only when the decision changes more than the effect and its record (`showcase/examples/winding-line/handlers/attention.ts`).
11. For live search, declare search and lookup queries with `defineDataProvider` (`showcase/examples/crm-capture/contracts/providers.ts`). Implement them with `implementDataProvider`, and back them with `createRemoteSource`, which resolves the caller's own credential first. A provider declared `identity: 'service'` reads with the service credential only.
12. Make following a search result a domain command that enqueues a follow effect.
13. For a target that is another agent-native application, import the peer API it publishes with `definePeerApi` and declare the target with `definePeerTarget` instead of `defineTarget`. Build effects with `target.effect(command, { resource, payload })`, so the peer's input schema checks the payload when the command enqueues. Add `target.destination` to the requirements. Connect it with `connectPeerTarget`, and serve remote queries from the peer with `createPeerSource`, `peerQuery` and `peerList`. Pass one `createPeerDrift` to both, so a peer operation whose schema changed waits instead of receiving input the peer would read differently. `packages/testing/test/peer-target.test.ts` shows the wiring. The called application serves its API with `createPeerLinkPlugin({ api })` from `@tortoise/peer-link/plugin` and adds `peerAllowlist(api)` to its policy's `integrations`, with an `integration` rule for each service operation (`plugins/peer-link/test/fixtures.ts`). The [connect-two-applications](../../../../plugins/peer-link/skills/connect-two-applications/SKILL.md) skill covers both sides, connecting with a code and the two-host tests.
14. For a target that can only be observed and acted on, such as a screen or an instrument, use convergent delivery from `packages/integration/src/convergent/`. Follow the `bridge-station-screen` skill (`workstations/screen-bridge/skills/bridge-station-screen/SKILL.md`) or `write-hardware-driver` (`plugins/connector-driver/skills/write-hardware-driver/SKILL.md`).

Never give the integration principal more than complete, sync and status. Never give a CLI or agent the system of record's credentials; it calls the application's capabilities.

## Checks

- Run `connectorConformance` from `@tortoise/testing/connectors` against the port. It covers idempotent delivery or lookup, rejection, lost replies and pull. `plugins/connector-driver/test/conformance.test.ts`, `plugins/connector-http/test/connector-http.test.ts` and `plugins/connector-files/test/connector-files.test.ts` and `packages/testing/test/peer-port.test.ts` show callers.
- Test a lost reply, a rejection, a held effect released and completed, and a stale sync range. `packages/integration/test/reliability.test.ts` covers them in the framework. `showcase/examples/receiving/test/receiving.test.ts` shows application tests for a rejected receipt, a held posting and a malformed export.

```sh
bun run test:integration
bun test showcase/examples/<app>
bun run generate
```

`generate` writes the capability reference, which states for each integrated command that a command result is not acceptance. Review the destinations in the generated security manifest; a command that invokes an integrated command is listed there as a `nested` flow with the same destinations. Record a run against the real system separately in [implementation status](../../../../docs/implementation-status.md).

## References

- [Systems of record](../../../../docs/systems-of-record.md)
- [`showcase/examples/quality-inspection`](../../../../showcase/examples/quality-inspection/README.md)
- [`showcase/examples/crm-capture`](../../../../showcase/examples/crm-capture/README.md)
- [System of record pattern](../../../../showcase/patterns/system-of-record/README.md)

---
name: connect-system-of-record
description: Connect an agent-native application to another system that keeps its own records (ERP, QMS, CRM, EAM, a peer host). Use when a command's write must be accepted by that system, when master data must be pulled in, when a screen or agent needs a live search over it, or when writing or testing a SystemOfRecordPort. Covers defineTarget, outbox effects and settlement, held and upstream effects, inbound sync, remote sources and data providers in packages/integration and examples/<app>/contracts/target.ts.
---

# Connect a system of record

The application owns its capture working set and pending effects; the other system stays the authority for its records. A local receipt proves the local commit, never acceptance by the target. The [system-of-record pattern](../../../../docs/system-of-record-pattern.md) explains the design and the [package README](../../README.md) lists every primitive. `examples/quality-inspection` is the worked outbox and sync example, and `examples/crm-capture` adds live search and adoption.

## Before writing

- Write down the trigger, the record each side owns, which outcomes the target can return (accepted, rejected, pending upstream), and who handles an exception.
- Decide how the target deduplicates: by effect ID (idempotent delivery) or through a lookup the dispatcher calls before every send. Without either, design the reconciliation path before the happy path.
- Decide whether reads mirror a working set (inbound sync) or answer at the moment of asking (remote query). Do not mirror a whole system to answer searches.

## Steps

1. **Declare the target** once with `defineTarget` in the browser-safe contracts (`examples/quality-inspection/contracts/target.ts`). It produces the settle, sync and status operations, the integration principal's grant and its policy lane. Declare a network destination that reads the target and queues while offline, or, for a system reached through shared folders, the exchange folders with `fileExchange` from `@agent-native/connector-files/component`.
2. **Enqueue in commands.** A command that forwards a record calls `ctx.enqueue` on a changed resource and declares `integration` on the capability. The record keeps its effect ID and delivery state. Never call the target inside a handler.
3. **Implement the settle and sync handlers** with `targetHandlers`: how an outcome changes the forwarded record, how a feed item changes local state, and which records a caller may count. Pass `versions` when the feed can deliver an older version after a newer one.
4. **Implement the port** (`SystemOfRecordPort`) as the only code that talks to the target, reaching it through the network port or the folder port. Start from a ready-made port when one fits: `httpTargetPort` (`plugins/connector-http`) for a REST system, with requests and rejection rules as data, or `fileTargetPort` (`plugins/connector-files`) for a file drop with receipts or an archive and an inbox of result exports. Return a business rejection as data, `DeliveryUncertain` when the outcome cannot be established, and `pending` when the target acknowledged but has not decided.
5. **Connect it** in `application.ts` with `connectTarget` (`examples/quality-inspection/application.ts`). A target without a feed only delivers.
6. **Reconcile held effects.** The dispatcher holds uncertain, lost-acknowledgement and recheck-denied effects and polls `upstream` ones. Only a domain command moves an effect out of `held`: settle it when the target applied or refused it, release it when it did not. Make held work queryable and visible on a screen (`examples/line-station/handlers/attention.ts`).
7. **Live search**: declare search and lookup queries with `defineDataProvider` (`examples/crm-capture/contracts/providers.ts`), implement them with `implementDataProvider`, and back them with `createRemoteSource`, which resolves the caller's own credential first. Adopting a result is a domain command that enqueues a follow effect.
8. **A target that can only be observed and acted on** (a screen, an instrument) uses convergent delivery from `packages/integration/src/convergent/`. See the `bridge-station-screen` skill (`packages/station/skills/bridge-station-screen/SKILL.md`) or `write-hardware-driver` (`plugins/connector-driver/skills/write-hardware-driver/SKILL.md`).

Never give the integration principal more than settle, sync and status, and never let a CLI or agent bypass application policy with broad upstream credentials.

## Checks

- Run `connectorConformance` from `@agent-native/testing/connectors` against the port (`plugins/connector-driver/test/conformance.test.ts`, `plugins/connector-http/test/connector-http.test.ts` and `plugins/connector-files/test/connector-files.test.ts` show callers). It covers idempotent delivery or lookup, rejection, lost replies and pull.
- Test a lost reply, a rejection, a held effect released and settled, and a stale sync range in the application's tests (`examples/quality-inspection/test/application.test.ts`).

```sh
bun run test:integration
bun test examples/<app>
bun run generate
```

`generate` writes the operation reference, which states for each integrated command that a receipt is not acceptance. Review the destinations in the generated security manifest. A fake system of record proves the wiring; a run against the real system is recorded separately in [implementation status](../../../../docs/implementation-status.md).

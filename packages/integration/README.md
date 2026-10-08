# @agent-native/integration

Delivery to and from systems that keep their own records. A command commits an outbox effect with its local change; the dispatcher delivers it later, outside any transaction, through a `SystemOfRecordPort`, and settles the outcome through an ordinary command under a narrow integration principal. Inbound sync imports upstream pages the same way, bound to a watermark. `createTargetIntegration` builds all of this for one target, so an application's `connect` declares targets instead of wiring workers.

Layer: framework (`packages/*`). Server only. Domain-neutral: the domain supplies the port implementation and the settlement and sync commands.

## Primitives

- [Connector](../../docs/primitives.md#connector): `SystemOfRecordPort` (with optional `search`), `SearchAccess`, `SearchPage`, `TargetDescription`, `LookupResult`, `DeliveryFailure`, `DeliveryUncertain`.
- [Dispatcher](../../docs/primitives.md#dispatcher): `createEffectDispatcher`, `createTargetIntegration`, `drainTargets`, `TargetBacklog`, `DispatchReport`.
- [Inbound sync](../../docs/primitives.md#inbound-sync): `createInboundSync`, `PullBatch`.
- [Remote query](../../docs/primitives.md#remote-query): `createRemoteSource`, `CallerCredentials`, `RemoteSourceOptions` turn a port's `search` into the runtime's `RemoteSource`, resolving the caller's credential first.
- [Data provider](../../docs/primitives.md#data-provider): `implementDataProvider` supplies a provider's search and lookup handlers from one item mapper.

The [system-of-record pattern](../../docs/system-of-record-pattern.md) explains the design. [`examples/quality-inspection/application.ts`](../../examples/quality-inspection/application.ts) wires a target against a fake quality system; [`examples/crm-capture/application.ts`](../../examples/crm-capture/application.ts) adds a remote source for live search.

## Entrypoints

| Import                        | Runs in     | Contents                                                                                                              |
| ----------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/integration`   | server only | Ports, dispatcher, inbound sync and target integration.                                                               |
| `@agent-native/integration/*` | server only | One source file: `port`, `dispatcher`, `drain`, `inbound-sync`, `target`, `loop`, `remote-source` or `data-provider`. |

## Trust boundary

The connector is the only code that talks to the external system. A target either declares idempotent delivery (the effect ID, derived from the command's receipt, is its idempotency key) or implements a lookup that the dispatcher consults before every send. A business rejection is data and is never retried. An outcome the connector cannot establish is reported as `DeliveryUncertain` and held for a person, never guessed or resent; that holds even when shutdown interrupts the pass. A held effect returns to delivery only through a reconciliation command.

A remote source resolves the caller's own credential through `CallerCredentials` and uses the service credential only when the query declares `caller-or-service`; without either it refuses with `FORBIDDEN` and never calls the port. A port's `search` returns a `SearchPage`; its `next` cursor must be bound to the query and credential that produced it, which the port alone can enforce. A `DeliveryFailure` from `search` becomes a caller-safe `UNAVAILABLE`, so provider error text is not passed on. `search` is called only by the runtime for a remote query; the dispatcher never uses it.

The integration grant can settle, sync and read status only; it cannot drive operator commands. `drain` reports whether anything is still pending, its deadline aborts a delivery in flight, and `drainTargets` reports outbox work for targets no dispatcher in this process can deliver instead of leaving it out.

Known gaps: no worker claims or fencing, no upstream-pending state, no cancel-before-dispatch, no dispatch-time recheck of the original actor's authority.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`. No network code: the port implementation reaches the target through the egress guard the host provides.

## Tests

```sh
bun run test:integration
```

- `test/remote-source.test.ts` enforces [P7](../../docs/principles.md#p7--other-systems-are-changed-only-through-durable-intents) for remote reads: the caller's credential first, a declared service fallback, refusal otherwise, a port without `search` as unavailable, safe failure messages, and the page cursor passing through in both directions.
- `test/dispatcher.test.ts` enforces [P7](../../docs/principles.md#p7--other-systems-are-changed-only-through-durable-intents) and [P12](../../docs/principles.md#p12--an-application-runs-beside-the-work-and-keeps-working-without-central-systems-or-a-model): delivery outside the transaction, backoff, rejection as data, lookup before resend, integration-grant limits, watermark-bound sync, and `drain` while the target stays down.
- `test/held.test.ts` enforces [P6](../../docs/principles.md#p6--status-reports-what-is-known-not-what-is-hoped): uncertain outcomes are held, not resent, including on shutdown; only held effects can be released; drain deadlines and cross-target accounting.

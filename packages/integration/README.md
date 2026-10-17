# @agent-native/integration

Delivery to and from systems that keep their own records. A command commits an outbox effect with its local change; the dispatcher delivers it later, outside any transaction, through a `SystemOfRecordPort`, and settles the outcome through an ordinary command under a narrow integration principal. Inbound sync imports upstream pages the same way, bound to a watermark. `createTargetIntegration` builds all of this for one target, so an application's `connect` declares targets instead of wiring workers. `targetHandlers` implements the settle, sync and status operations of a target declared with `defineTarget` in `@agent-native/contracts`, and `connectTarget` connects it to its port.

Layer: framework (`packages/*`). Server only. Domain-neutral: the domain supplies the port implementation and the settlement and sync commands.

## Primitives

- [Connector](../../docs/primitives.md#connector): `SystemOfRecordPort` (with optional `search`), `SearchAccess`, `SearchPage`, `TargetDescription`, `DeliveryResult`, `UpstreamPending`, `LookupResult`, `DeliveryFailure`, `DeliveryUncertain`; `createPeerPort`, `PeerPortOptions`, `PeerClient` and `payloadBlobs` for a target that is another agent-native host.
- [Dispatcher](../../docs/primitives.md#dispatcher): `createEffectDispatcher` (with `worker`, `leaseMs` and `recheck`), `createTargetIntegration`, `drainTargets`, `TargetBacklog`, `DispatchReport`. `src/dispatcher/delivery.ts` holds the per-effect steps: claim, look up or deliver, poll an acknowledged effect, record under the claim's fence and settle.
- [Worker claims](../../docs/primitives.md#worker-claims): every attempt and, for `defineTarget` settle commands, every settlement carries the claim's fencing token.
- [Reconciliation](../../docs/primitives.md#reconciliation): the dispatcher holds an effect whose outcome is uncertain, whose acknowledgement the target lost, or whose actor the recheck denies, and polls an acknowledged one instead of resending it.
- [Inbound sync](../../docs/primitives.md#inbound-sync): `createInboundSync`, `PullBatch`, and upstream versions through `UpstreamVersions` and `newerItems`.
- [Target](../../docs/primitives.md#target): `targetHandlers`, `TargetHandlerOptions`, `TargetCursor`, `settleDelivery`, `Delivered`, `targetContext`, `targetLane`, `targetRules`, `connectTarget`.
- [Remote query](../../docs/primitives.md#remote-query): `createRemoteSource`, `CallerCredentials`, `RemoteSourceOptions` turn a port's `search` into the runtime's `RemoteSource`, resolving the caller's credential first.
- [Data provider](../../docs/primitives.md#data-provider): `implementDataProvider` supplies a provider's search and lookup handlers from one item mapper.
- [Gated actuator](../../docs/primitives.md#gated-actuator): `src/convergent/` holds convergent delivery for a target that can only be observed and acted on, such as a screen or an instrument, with no idempotency key. `deliverConvergent` observes first and accepts without acting when the target already shows the state. Otherwise it fails transiently when the target is not ready, rejects unmet preconditions and fails on unreadable ones, then acts. `confirm` and `waitFor` judge a condition across consecutive reads on a `ReadClock`. `interruption` turns a stop after acting into `DeliveryUncertain` unless the action is rerunnable. `lookupConvergent` and `AttemptMemory` decide whether an earlier attempt may be delivered again. The connector keeps its own gate (mode, seat, payload); the station controller is the first caller.

The [system-of-record pattern](../../docs/system-of-record-pattern.md) explains the design. [`examples/quality-inspection/application.ts`](../../examples/quality-inspection/application.ts) wires a target against a fake quality system; [`examples/crm-capture/application.ts`](../../examples/crm-capture/application.ts) adds a remote source for live search.

## Entrypoints

| Import                        | Runs in     | Contents                                                                                                                                 |
| ----------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/integration`   | server only | Ports, dispatcher, inbound sync and target integration.                                                                                  |
| `@agent-native/integration/*` | server only | One source file: `port`, `dispatcher`, `drain`, `inbound-sync`, `target`, `target-handlers`, `loop`, `remote-source` or `data-provider`. |

## Trust boundary

The connector is the only code that talks to the external system. A target either declares idempotent delivery (the effect ID, derived from the command's receipt, is its idempotency key) or implements a lookup that the dispatcher consults before every send. A business rejection is data and is never retried. An outcome the connector cannot establish is reported as `DeliveryUncertain` and held for a person, never guessed or resent; that holds even when shutdown interrupts the pass. A held effect returns to delivery only through a reconciliation command.

A remote source resolves the caller's own credential through `CallerCredentials` and uses the service credential only when the query declares `caller-or-service`; without either it refuses with `FORBIDDEN` and never calls the port. A port's `search` returns a `SearchPage`; its `next` cursor must be bound to the query and credential that produced it, which the port alone can enforce. A `DeliveryFailure` from `search` becomes a caller-safe `UNAVAILABLE`, so provider error text is not passed on. `search` is called only by the runtime for a remote query; the dispatcher never uses it.

The peer port speaks the peer host's HTTP API through a client the caller supplies (a paired device's network port), so the peer authorizes every call as that client's credential. It uploads each blob the payload references and checks the stored digest before invoking the command named by the effect type, with the effect ID as idempotency key; the peer's receipt makes a repeat after a lost response return the first result. `INVALID_INPUT`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT` and `IDEMPOTENCY_CONFLICT` settle the effect as rejected. A `FORBIDDEN` that refuses the credential itself (`details.credential`), an unreachable peer and a server error are `DeliveryFailure`s, so the record waits for a new pairing instead of being rejected.

The integration grant can settle, sync and read status only; it cannot drive operator commands. A target's settle handler checks, inside the transaction, that the effect belongs to the calling principal's target before it records anything, and `settleDelivery` refuses a record that forwarded a different effect. `drain` reports whether anything is still pending, its deadline aborts a delivery in flight, and `drainTargets` reports outbox work for targets no dispatcher in this process can deliver instead of leaving it out.

Known gaps: no worker claims or fencing, no upstream-pending state, no cancel-before-dispatch, no dispatch-time recheck of the original actor's authority.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, and `@agent-native/event-log` (tests). No network code: the port implementation reaches the target through the egress guard the host provides.

## Tests

```sh
bun run test:integration
```

- `test/remote-source.test.ts` covers remote reads: the caller's credential first, a declared service fallback, refusal otherwise, a port without `search` as unavailable, safe failure messages, and the page cursor passing through in both directions.
- `test/dispatcher.test.ts`: delivery outside the transaction, backoff, rejection as data, lookup before resend, integration-grant limits, watermark-bound sync, and `drain` while the target stays down.
- `test/target.test.ts`: a declared target's derived IDs and grant, delivery and feed through `connectTarget`, the watermark conflict and side lists, settling another target's effect, the lane closing settle and sync to everyone else, and `settleDelivery` on a mismatched record.
- `test/held.test.ts`: uncertain outcomes are held, not resent, including on shutdown; only held effects can be released; drain deadlines and cross-target accounting.
- `test/convergent.test.ts`: acceptance without acting, the not-ready, precondition and act paths, consecutive reads, interruption and the lookup rules, against a fake instrument.
- `test/reliability.test.ts`: a paused worker against the one after its lease, a kill after the target accepted, an acknowledged effect polled and drained, cancel before a claim, the actor recheck before the first claim and after revocation, and out-of-order upstream versions.

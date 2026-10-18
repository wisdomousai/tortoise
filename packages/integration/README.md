# @agent-native/integration

Delivery to and from a [system of record](../../docs/glossary.md#system-of-record). A command commits an [outbox effect](../../docs/glossary.md#effect) with its local change. The [dispatcher](../../docs/glossary.md#dispatcher) delivers it later, outside any transaction, through a `SystemOfRecordPort`, and settles the outcome through an ordinary command under a narrow [integration principal](../../docs/glossary.md#integration-principal). [Inbound sync](../../docs/glossary.md#inbound-sync) imports the system of record's pages the same way, bound to a [watermark](../../docs/glossary.md#watermark).

`createTargetIntegration` builds all of this for one [target](../../docs/glossary.md#target), so an application's `connect` declares targets instead of wiring workers. `targetHandlers` implements the settle, sync and status capabilities of a target declared with `defineTarget` in `@agent-native/contracts`. `connectTarget` connects the target to its port. A target declared without a feed only delivers, and its inbound side pulls nothing.

## Layer

Framework (`packages/*`). Server only. Domain-neutral: the domain supplies the port implementation and the settlement and sync commands. The package trusts the connector and the application's commands, and treats what the system of record returns as data.

## Primitives

- [Connector](../../docs/primitives.md#connector): `SystemOfRecordPort` (with optional `search`), `SearchAccess`, `SearchPage`, `TargetDescription`, `DeliveryResult`, `UpstreamPending`, `LookupResult`, `DeliveryFailure`, `DeliveryUncertain`. `createPeerPort`, `PeerPortOptions`, `PeerClient` and `payloadBlobs` serve a target that is another agent-native host.
- [Dispatcher](../../docs/primitives.md#dispatcher): `createEffectDispatcher` (with `worker`, `leaseMs` and `recheck`), `createTargetIntegration`, `drainTargets`, `TargetBacklog`, `DispatchReport`. `src/dispatcher/delivery.ts` holds the per-effect steps: claim, look up or deliver, poll an acknowledged effect, record under the claim's fence and settle.
- [Worker claims](../../docs/primitives.md#worker-claims): every attempt carries the claim's fencing token. For `defineTarget` settle commands, every settlement carries it too.
- [Reconciliation](../../docs/primitives.md#reconciliation): the dispatcher holds an effect in three cases: its outcome cannot be established, the target lost its acknowledgement, or the recheck denies its original caller. It polls an acknowledged effect instead of resending it.
- [Inbound sync](../../docs/primitives.md#inbound-sync): `createInboundSync`, `PullBatch`, and upstream versions through `UpstreamVersions` and `newerItems`.
- [Target](../../docs/primitives.md#target): `targetHandlers`, `TargetHandlerOptions`, `TargetCursor`, `settleDelivery`, `Delivered`, `targetContext`, `targetLane`, `targetRules`, `connectTarget`.
- [Remote query](../../docs/primitives.md#remote-query): `createRemoteSource`, `CallerCredentials` and `RemoteSourceOptions` turn a port's `search` into the runtime's `RemoteSource`. The source resolves the caller's credential first.
- [Data provider](../../docs/primitives.md#data-provider): `implementDataProvider` supplies a provider's search and lookup handlers from one item mapper.
- [Gated actuator](../../docs/primitives.md#gated-actuator): `src/convergent/` holds convergent delivery, described under [Convergent delivery](#convergent-delivery).

[Systems of record](../../docs/systems-of-record.md) explains the design. [`examples/quality-inspection/application.ts`](../../examples/quality-inspection/application.ts) wires a target against a fake quality system. [`examples/crm-capture/application.ts`](../../examples/crm-capture/application.ts) adds a remote source for a remote query.

## Entrypoints

| Import                        | Runs in     | Contents                                                                                                                                                                 |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@agent-native/integration`   | server only | Ports, dispatcher, inbound sync, target integration, remote source, data provider, peer port and convergent delivery.                                                    |
| `@agent-native/integration/*` | server only | One source file: `port`, `dispatcher`, `drain`, `inbound-sync`, `target`, `target-handlers`, `loop`, `remote-source`, `data-provider`, `peer-port` or `convergent`. |

### Convergent delivery

Convergent delivery serves a target that can only be observed and acted on, such as a screen or an instrument, with no idempotency key. `deliverConvergent` observes first and accepts without acting when the target already shows the state. Otherwise it takes these steps:

1. It fails transiently when the target is not ready.
2. It rejects unmet preconditions and fails on unreadable ones.
3. It acts.

`confirm` and `waitFor` judge a condition across consecutive reads on a `ReadClock`. `interruption` turns a stop after acting into `DeliveryUncertain` unless the action is rerunnable. `lookupConvergent` and `AttemptMemory` decide whether an earlier attempt may be delivered again. The connector keeps its own gate: mode, seat and payload. The station controller is the first caller.

## Trust boundary

### Delivery

The connector is the only code that talks to the system of record. A target either declares idempotent delivery or implements a lookup that the dispatcher consults before every send. With idempotent delivery, the effect ID is the idempotency key; it derives from the command's receipt.

A business rejection is data and is not retried. The connector reports an outcome it cannot establish as `DeliveryUncertain`, and the dispatcher holds the effect for a person instead of guessing or resending. This applies even when shutdown interrupts the pass. A held effect returns to delivery only through a [reconciliation](../../docs/glossary.md#reconciliation) command.

### Remote sources

A remote source resolves the caller's own credential through `CallerCredentials`. It uses the service credential only when the query declares `caller-or-service`. Without either credential it refuses with `FORBIDDEN` and does not call the port.

A port's `search` returns a `SearchPage`. Its `next` cursor must be bound to the query and credential that produced it, and only the port can enforce that. A `DeliveryFailure` from `search` becomes a caller-safe `UNAVAILABLE`, so provider error text is not passed on. Only the runtime calls `search`, for a remote query; the dispatcher does not use it.

### Peer port

The peer port speaks the peer host's HTTP API through a client the caller supplies, such as a paired device's network port. The peer therefore authorizes every call as that client's credential. The port uploads each blob the payload references and checks the stored digest. It then invokes the command named by the effect type, with the effect ID as idempotency key. The peer's receipt makes a repeat after a lost response return the first result.

`INVALID_INPUT`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT` and `IDEMPOTENCY_CONFLICT` settle the effect as rejected. These are `DeliveryFailure`s instead:

- a `FORBIDDEN` that refuses the credential itself (`details.credential`);
- an unreachable peer;
- a server error.

The record then waits for a new pairing instead of being rejected.

### Integration grant

The integration grant can settle, sync and read status only. It cannot drive operator commands. A target's settle handler checks, inside the transaction, that the effect belongs to the calling principal's target before it records anything. `settleDelivery` refuses a record that forwarded a different effect.

`drain` reports whether anything is still pending, and its deadline aborts a delivery in flight. `drainTargets` reports outbox work for targets that no dispatcher in this process can deliver, instead of leaving that work out.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, and `@agent-native/event-log` in tests. The package has no network code. The port implementation reaches the target through the [egress guard](../../docs/glossary.md#egress-guard) the host provides.

## Tests

```sh
bun run test:integration
```

- `test/remote-source.test.ts`: the caller's credential first, a declared service fallback, refusal otherwise, a port without `search` as unavailable, safe failure messages, and the page cursor passing through in both directions.
- `test/dispatcher.test.ts`: delivery outside the transaction, backoff, rejection as data, lookup before resend, integration-grant limits, watermark-bound sync, `drain` while the target stays down, and a loop stopped right after it started.
- `test/target.test.ts`: a declared target's derived IDs and grant, delivery and feed through `connectTarget`, the watermark conflict and side lists, and settling another target's effect. It also covers the lane closing settle and sync to everyone else, `settleDelivery` on a mismatched record, and a target without a feed connected with an idle inbound side.
- `test/held.test.ts`: effects with unknown outcomes are held and not resent, including on shutdown; only held effects can be released; drain deadlines and cross-target accounting.
- `test/reconciliation.test.ts`: `reconciliationHandlers` across two targets.
  - Each person lists only the held effects of their records, filtered by target or record.
  - Another person's effect reads as missing.
  - Not applied delivers the effect again, applied settles it with the person's reference, and refused settles it as rejected.
  - The domain's `onResolved` runs in each transaction.
- `test/convergent.test.ts`: acceptance without acting, the not-ready, precondition and act paths, consecutive reads, interruption and the lookup rules, against a fake instrument.
- `test/reliability.test.ts`: a paused worker against the one that took over after its claim expired, a kill after the target accepted, and an acknowledged effect polled and drained. It also covers cancel before a claim, the original caller's recheck before the first claim and after revocation, and out-of-order upstream versions.

## Skills

- [connect-system-of-record](skills/connect-system-of-record/SKILL.md): connect a system of record with outbox delivery and settlement, held effects, inbound sync, a remote query or a new `SystemOfRecordPort`.

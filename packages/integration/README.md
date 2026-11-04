# @tortoise/integration

Delivery to and from a system of record. A command commits an outbox effect with its change; the dispatcher delivers it later and records the outcome, and inbound sync imports pages under a watermark. The connector is the only code that talks to the system of record. A target either declares idempotent delivery or implements a lookup the dispatcher consults before every send.

## Peer applications

To deliver to another agent-native application, use `connectPeerTarget` with a `PeerLink` from [`@tortoise/peer-link`](../../plugins/peer-link/README.md). The peer applies its own policy to every call.

- Primitives: [Connector](../../docs/primitives.md#connector), [Dispatcher](../../docs/primitives.md#dispatcher), [Worker claims](../../docs/primitives.md#worker-claims), [Reconciliation](../../docs/primitives.md#reconciliation), [Inbound sync](../../docs/primitives.md#inbound-sync), [Peer target](../../docs/primitives.md#peer-target), [Target](../../docs/primitives.md#target), [Remote query](../../docs/primitives.md#remote-query), [Data provider](../../docs/primitives.md#data-provider), [Interlock](../../docs/primitives.md#interlock).

## References

- [connect-system-of-record](skills/connect-system-of-record/SKILL.md), [connect-two-applications](../../plugins/peer-link/skills/connect-two-applications/SKILL.md)
- [Systems of record](../../docs/systems-of-record.md)
- Test: `bun run test:integration`

# @tortoise/integration

`@tortoise/integration` connects a declared target to its external port. `connectTarget` wires the dispatcher and optional inbound synchronizer to the application's completion and sync operations. The application supplies the integration principal used for those calls.

The dispatcher claims committed effects before delivery and records the external outcome through the target's completion command. A connector must declare idempotent delivery or implement the outcome lookup required to avoid an unsafe resend. Uncertain outcomes remain held for reconciliation. Inbound pages are applied through the sync command under its watermark check.

## Peer applications

To deliver to another agent-native application, use `connectPeerTarget` with a `PeerLink` from [`@tortoise/peer-link`](../../plugins/peer-link/README.md). The peer applies its own policy to every call.

## References

[connect-system-of-record](skills/connect-system-of-record/SKILL.md), [connect-two-applications](../../plugins/peer-link/skills/connect-two-applications/SKILL.md)

[Systems of record](../../docs/systems-of-record.md)

Test: `bun run test:integration`

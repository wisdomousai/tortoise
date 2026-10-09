# @agent-native/event-log

An append-only, hash-chained audit log of every command, query, denial, outbox transition, sync pass, connection and run. The journal tells views what changed; the event log tells an auditor who did what, through which surface, and what was refused. Inject an `EventLogPort` into the runtime, egress guard, dispatcher and host; nothing in the framework writes audit events any other way.

Layer: framework (`packages/*`). Server only. The event envelope and port types live in [`@agent-native/contracts`](../contracts/README.md) so screens can render events without loading this package.

## Primitives

- [Event log](../../docs/primitives.md#event-log): `createMemoryEventLog`, `openJsonlEventLog`, `verifyEventLog`, `unresolvedCommands`, `readEvents`, `forwardingEventLog`.

[Security and compliance](../../docs/security-and-compliance.md) covers audit modes and verification. The [`@agent-native/audit`](../../plugins/audit/README.md) plugin opens this log and provides it as the host's event-log port.

## Entrypoints

| Import                      | Runs in     | Contents                                                            |
| --------------------------- | ----------- | ------------------------------------------------------------------- |
| `@agent-native/event-log`   | server only | Chain helpers, memory and JSONL logs, verification and forwarding.  |
| `@agent-native/event-log/*` | server only | One source file: `chain`, `memory`, `jsonl`, `verify` or `forward`. |

## Trust boundary

Events carry the actor and channel, operation, a safe reason code, correlation IDs and an input digest. Input values appear only for fields a capability allow-lists in `audit.fields`; egress events never contain bodies. The runtime appends `command.accepted` inside the transaction, so in required mode a failed append rolls the command back, and startup resolves accepted commands a crash left open (`unresolvedCommands`).

The JSONL adapter chains SHA-256 across rotated segments, syncs every append, writes `0600` files in a directory separate from the workspace, and admits one writer per directory (`EventLogLockedError`). A torn final line from an unacknowledged append is truncated and recorded on open. The verifier reports edits, gaps, reordering and truncated segments. Forwarding sends RFC 5424 syslog through the egress guard after the local append, and counts sink failures without failing callers.

Gaps: removing the newest events is detectable only against an anchor or a forwarded copy. No off-host collector has been exercised.

## Dependencies

Framework: `@agent-native/contracts`. Node: `node:crypto` and the filesystem.

## Tests

```sh
bun test packages/event-log
```

`test/event-log.test.ts` enforces [P13](../../docs/principles.md#p13--declared-reach-recorded-actions): chaining and canonical form, concurrent appends, durable reopen, rotation, tamper detection, torn-line recovery, rejected batches, verification up to the writer head, the single-writer lock and RFC 5424 forwarding. The rollback of a command whose required append fails is tested in `packages/runtime/test/audit.test.ts`.

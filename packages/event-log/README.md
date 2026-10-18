# @agent-native/event-log

This package implements the [audit log](../../docs/glossary.md#audit-log): an append-only, hash-chained record of every command, query, denial, outbox transition, sync pass, connection and run. The [journal](../../docs/glossary.md#journal) tells screens what changed. The audit log tells an auditor who did what, through which [surface](../../docs/glossary.md#surface), and what was refused.

## Layer

Framework (`packages/*`). Server only as a whole. The `chain`, `memory` and `forward` modules use no Node or Bun API and run on any JavaScript host. The event envelope and port types live in [`@agent-native/contracts`](../contracts/README.md), so screens can render events without loading this package.

## Primitives

- [Audit log](../../docs/primitives.md#audit-log): `createMemoryEventLog`, `openJsonlEventLog`, `verifyEventLog`, `unresolvedCommands`, `readEvents`, `forwardingEventLog`.

Inject an `EventLogPort` into the runtime, the egress guard, the dispatcher and the host. Nothing in the framework writes audit events any other way. The [`@agent-native/audit`](../../plugins/audit/README.md) plugin opens this log and provides it as the host's `EventLogPort`. [Security and compliance](../../docs/security-and-compliance.md#audit-log) covers audit modes and verification.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/event-log` | server only | Chain helpers, memory and JSONL logs, verification and forwarding. |
| `@agent-native/event-log/*` | per file | One source file: `chain`, `memory` and `forward` run anywhere; `jsonl` and `verify` are server only. |

## Trust boundary

### Event contents

Events carry the principal and channel, the operation ID, a safe reason code, correlation IDs and an input digest. Input values appear only for fields a capability allow-lists in `audit.fields`. Egress events never contain bodies.

The runtime appends `command.accepted` inside the transaction. In required mode, a failed append therefore rolls the command back. At startup, `unresolvedCommands` resolves accepted commands that a crash left open.

### JSONL log

The JSONL adapter:

- chains SHA-256 across rotated segments;
- syncs every append;
- writes `0600` files in a directory separate from the workspace;
- admits one writer per directory and refuses others with `EventLogLockedError`.

A torn final line from an unacknowledged append is truncated and recorded on open. The verifier reports edits, gaps, reordering and truncated segments.

### Forwarding

Forwarding sends RFC 5424 syslog through the egress guard after the local append. It counts sink failures without failing callers.

Removing the newest events is detectable only against an anchor or a forwarded copy. No off-host collector has been exercised.

## Dependencies

Framework: `@agent-native/contracts`. External: `@noble/hashes` for SHA-256. Node and Bun: the filesystem and `bun:sqlite`, in `jsonl` and `verify` only.

## Tests

```sh
bun test packages/event-log
```

- `test/event-log.test.ts`: chaining and canonical form, concurrent appends, durable reopen, rotation, tamper detection, torn-line recovery and rejected batches. It also covers verification up to the writer head, the single-writer lock and RFC 5424 forwarding.

`packages/runtime/test/audit.test.ts` tests the rollback of a command whose required append fails.

## Skills

None. `plugins/audit` opens the log, and the package has no extension point of its own.

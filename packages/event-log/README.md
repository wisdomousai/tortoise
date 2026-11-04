# @tortoise/event-log

The audit log: an append-only, hash-chained record of every command, query, denial, outbox change, sync, connection and run. Each event records an input digest; input values appear only for fields a capability allow-lists in `audit.fields`. Check a log with `bun run cli audit verify --log .workspace/audit`.

- Primitives: [Audit log](../../docs/primitives.md#audit-log).

## References

- [Security and compliance](../../docs/security-and-compliance.md#audit-log)

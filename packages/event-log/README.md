# @tortoise/event-log

`@tortoise/event-log` implements the audit event store used by configured host components. `openJsonlEventLog` opens an append-only JSONL log under a writer lock. Events form a hash chain, and `verifyEventLog` checks its ordering and integrity.

The package also supplies an in-memory log for tests and forwarding to a configured sink. Audit input digests and field disclosure are determined by the component producing the event. The runtime's audit ordering is specified in [Security and compliance](../../docs/security-and-compliance.md#audit-log).

## References

[Security and compliance](../../docs/security-and-compliance.md#audit-log)

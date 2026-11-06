# @tortoise/runtime

`@tortoise/runtime` executes a composed catalog against workspace storage. The host constructs the application with `createApplication` and supplies trusted caller context for each invocation. Application handlers register through `createHandlerFactory`.

A successful command commits its record changes with journal entries and any retained command result. Enqueued outbox effects participate in that transaction. Failure before commit rolls back the transaction. Queries use a read snapshot and must leave state unchanged.

The runtime rechecks authorization during execution and before commit. Handlers register changed resources so the runtime can assign revisions. Expected revisions and idempotency keys are caller-supplied controls whose behavior is specified in [Operations and state](../../docs/capability-authoring.md).

## References

[add-capability](skills/add-capability/SKILL.md)

[Architecture](../../docs/architecture.md), [Authorization](../../docs/authorization.md), [Operations and state](../../docs/capability-authoring.md)

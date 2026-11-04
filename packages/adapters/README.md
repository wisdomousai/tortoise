# @tortoise/adapters

Implementations behind the runtime's ports: SQLite and Postgres storage, blobs, workspace leases, and the HTTP, MCP and CLI channels. The channels contain no business logic, so a new capability appears on all of them at once. Every channel derives identity from the host session, the connection file or the grant file, never from a request body or tool arguments.

- Primitives: [Channel adapter](../../docs/primitives.md#channel-adapter), [Agent definition](../../docs/primitives.md#agent-definition), [Instance](../../docs/primitives.md#instance), [Execution context](../../docs/primitives.md#execution-context), [Policy](../../docs/primitives.md#policy), [Storage](../../docs/primitives.md#storage), [Workspace lease](../../docs/primitives.md#workspace-lease), [Blob store](../../docs/primitives.md#blob-store), [UI session context](../../docs/primitives.md#ui-session-context), [Shell port](../../docs/primitives.md#shell-port).

## References

- [run-a-hosted-instance](../host/skills/run-a-hosted-instance/SKILL.md)
- [Adapters](../../docs/adapters.md)

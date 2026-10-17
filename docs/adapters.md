# Adapter boundaries

Feature contracts never mention how the application is hosted or stored. Each external dependency enters through a port with stated guarantees, and the reference adapters are local: Bun, SQLite, loopback HTTP and stdio.

| Port                 | Reference adapters                                       | What an adapter has to keep                                                                                                             |
| -------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Transaction storage  | Clone-on-write memory; SQLite holding a JSON snapshot    | State, revisions, receipts and journal commit together or not at all; a read sees one consistent snapshot.                              |
| Authorization        | A bounded CASL profile                                   | Operation, object and field checks; scope applied before paging; current access on replay and events; unsupported rules deny.           |
| Identity and session | Local owner or launcher grant, depending on site policy  | Principal, workspace and grant come from trusted context, never from operation input.                                                   |
| Transport            | Loopback HTTP/SSE; MCP over stdio; the CLI               | Dispatch through the runtime, keep the structured error envelope, validate origin and session, and deliver events under current access. |
| Agent harness        | Deterministic fixture; Codex, Claude and AI SDK adapters | Provider types stay private; progress is not a commit; cancellation and recovery stay explicit.                                         |
| Event log            | Memory; hash-chained JSONL with one locked writer        | Ordered, chained, synced appends; in required mode a failed append rolls the command back.                                              |
| Egress               | In-process guard, scoped socket, CONNECT proxy           | Only declared, policy-bound destinations; redirects and DNS answers are checked; every decision is recorded.                            |

## Storage

Storage offers two operations: a transaction and a read, each scoped to one workspace. The core treats feature state as opaque, cloneable data and keeps framework metadata beside it. The memory adapter isolates copies and serializes work per workspace. The SQLite adapter stores one row per record (a module slice, a collection, a record) inside explicit transactions and writes only the rows a commit changed. The Postgres adapter uses the same row layout and serializes commits to one workspace across hosts with an advisory lock; a workspace lease adds a fencing check to every commit. Neither is a set of per-table repositories.

A different database can back the same port if it gives the same atomicity: receipts and journal entries are written in the business transaction, never after it. `storageConformance` in `packages/testing` is the suite a new adapter passes; `pgliteDriver` runs the Postgres adapter in process for it. Run history is stored separately and is not a substitute for receipts.

## Systems of record are not storage

An external business API cannot join the local transaction. Model it as a connector instead. Commit a delivery intent locally, do the external work outside the transaction, and record the outcome through a trusted command. Identity and version mapping, idempotency, uncertain outcomes and reconciliation are part of that connector's contract. See the [system-of-record pattern](system-of-record-pattern.md).

## Authorization

The CASL adapter accepts equality, membership and boolean conditions over registered scalar fields. Denials are part of the computed scope, and unsupported operators are rejected rather than ignored. Generated SQL parameterizes values and validates column names. Field restrictions also limit which filters and sorts a caller can use. A new condition operator needs agreement tests across object, memory and SQL evaluation before it is used.

Policy receives the trusted context, the capability, validated input, current state and, at commit, the previous state. It projects output to what the caller may see and decides whether an event reference may be delivered. The runtime checks grants (operation, expiry and binding) and changed-resource restrictions. A remote policy adapter documents its own revocation consistency; the local one does not promise atomic authorization across systems.

## Transports

HTTP cursors are encrypted strings bound to the caller. A restart changes the key, so clients take a fresh snapshot. Event delivery enqueues inside the storage read boundary, so a permission change cannot commit between the access check and the enqueue. A transport forwards events through that boundary, not as a batch it authorized earlier.

To move to another host, inject its identity, policy and storage, and keep the catalog and handlers. To add a transport, map requests onto the runtime's raw invoke and query and keep the error envelope, revisions and authorization state. No cloud adapter ships here; the ports make one a defined piece of work.

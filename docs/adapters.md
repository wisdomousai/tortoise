# Adapters

The framework reaches storage and serves the HTTP, MCP and CLI surfaces through ports. Each port has a reference adapter that applications replace as needed.

## Ports

| Port | Reference adapters | What an adapter keeps |
| --- | --- | --- |
| Storage | Memory, SQLite, Postgres, snapshot | State, revisions, receipts and journal commit together, and a read sees one snapshot. |
| Authorization | `definePolicy`; a bounded CASL profile | Operation, object and field checks, scope before paging, current access on replay and events, and denial of unsupported rules. |
| Identity and session | Local owner, grant file or workforce sign-in, by the deployment policy | Principal, workspace and grant come from trusted context, never from capability input. |
| Surfaces | Loopback HTTP and SSE; MCP over stdio; the CLI | Calls go through the instance with the error envelope, and events follow current access. |
| Agent harness | Deterministic fixture; Codex, Claude, AI SDK and local model adapters | Provider types stay private, progress is not a commit, and cancellation and recovery stay explicit. |
| Audit log | Memory; hash-chained JSONL with one locked writer | Each append goes in order, chained and synced; in required mode a failed append rolls back the command. |
| Egress | In-process guard, scoped socket, CONNECT proxy | Only declared, bound destinations; the guard checks redirects and DNS responses and records every decision. |

## Storage

The storage port offers a transaction and a read, each scoped to one workspace. A failed transaction commits nothing. Module state is opaque structured-clone data; framework metadata sits beside it.

- **Memory** — isolates copies and serializes work per workspace. Tests use it.
- **SQLite** — one row per record (module slice, collection, record) and per revision, receipt, effect and journal entry. A commit writes only the rows it changed, in one transaction.
- **Postgres** — the same row layout. An advisory lock serializes commits to one workspace across hosts.
- **Snapshot** — one JSON document per workspace. The mobile host uses it.

SQLite converts an older one-document file when it opens it. The row layout is not a relational model of module state. On the hosted platform, a workspace lease adds a fencing check to every Postgres commit ([hosting](hosting.md#workspace-lease-and-fence)).

Another database can back the port if it gives the same atomicity: it writes receipts and journal entries in the business transaction, never after it. Run history sits in its own store and does not replace receipts.

## Systems of record

A system of record cannot join the local transaction, so it is not storage. A command commits an outbox effect. The dispatcher delivers it afterwards, and a trusted command records the outcome. Identity and version mapping, idempotency, held effects and reconciliation belong to the connector's contract.

## Surface adapters

Each surface adapter calls the instance's command and query entry points with host-supplied context.

### HTTP

The HTTP adapter checks Host and Origin headers and refuses cross-origin browser writes. A browser gets its session through the launch key exchange. The adapter refuses a peer application's call for one of its people at `/api/v1/launch` and `/api/v1/events`, limiting it to that person's operations. Errors return the error envelope with a matching status code.

The adapter encrypts cursors and binds them to the session. A restart changes the key, so a live query takes a fresh snapshot. The event stream:

- Rechecks the session before each pull
- Delivers one batch per pull
- Authorizes and enqueues each batch inside the storage read boundary, so a permission change cannot commit between the access check and the enqueue

An adapter forwards events through that boundary, never as a batch it authorized earlier.

### MCP

The MCP bridge serves one tool per capability over stdio. A tool call accepts:

- the input
- an idempotency key
- expected revisions

A model cannot set trusted context. Commands require a key. Every failure is a tool error with the error envelope.

In attached mode, the bridge reads the connection file and calls the instance over loopback HTTP. In embedded mode, it runs the instance in process under a grant file, and cursors are plain journal positions because no network session exists.

### CLI

The CLI maps arguments onto the catalog; the instance decides identity and authorization. Output is JSON by default. A failure prints the error envelope and exits with a mapped code ([exit codes](systems-of-record.md#exit-codes)).

## Adapter replacement

To move to another host, inject its identity, policy and storage while keeping the catalog and handlers. To add a surface, map requests onto the instance's raw command and query entry points (`packages/adapters/src/application-port.ts`), preserving:

- the error envelope
- revisions
- authorization state

No adapter for a cloud provider ships.

A new storage adapter passes `storageConformance` from `packages/testing`, which checks atomicity, isolation and persistence. `pgliteDriver` runs the Postgres adapter in-process for it.

```sh
bun test packages/testing/test/storage.test.ts
bun test showcase/examples/field-service/test/transport-conformance.test.ts
```

The first runs the suite on the memory, SQLite and Postgres adapters. The second compares results and errors across the in-process, HTTP, CLI and MCP adapters.

## References

- [Authorization](authorization.md)
- [Architecture](architecture.md#host-plugins)
- [Security and compliance](security-and-compliance.md)
- [Agents](agents.md)
- [Systems of record](systems-of-record.md)
- [Architecture](architecture.md#surfaces-and-identity)

# Adapters

The framework reaches storage and serves the HTTP, MCP and CLI [surfaces](glossary.md#surface) through ports. Each port has a reference adapter that an application can replace.

## Concepts

Terms: the [adapter](glossary.md#adapter), the [surface](glossary.md#surface) adapters and the [storage](glossary.md#storage) adapters.

## Ports

[Capabilities](glossary.md#capability) never mention how the application is hosted or stored. Each outside dependency enters through a port with stated guarantees. The reference adapters are local: Bun, SQLite, loopback HTTP and stdio.

| Port | Reference adapters | What an adapter keeps |
| --- | --- | --- |
| Storage | Memory, SQLite, Postgres, snapshot | State, revisions, receipts and journal commit together, and a read sees one snapshot. |
| Authorization | `definePolicy`; a bounded CASL profile | Operation, object and field checks, scope before paging, current access on replay and events, and denial of unsupported rules. |
| Identity and session | Local owner, grant file or workforce sign-in, by the deployment policy | Principal, workspace and grant come from trusted context, never from capability input. |
| Surfaces | Loopback HTTP and SSE; MCP over stdio; the CLI | Calls go through the instance with the error envelope, and events follow current access. |
| Agent harness | Deterministic fixture; Codex, Claude, AI SDK and local model adapters | Provider types stay private, progress is not a commit, and cancellation and recovery stay explicit. |
| Audit log | Memory; hash-chained JSONL with one locked writer | Appends are ordered, chained and synced; in required mode a failed append rolls back the command. |
| Egress | In-process guard, scoped socket, CONNECT proxy | Only declared, bound destinations; redirects and DNS answers are checked and every decision is recorded. |

## Storage

The storage port offers a transaction and a read, each scoped to one [workspace](glossary.md#workspace). A failed transaction commits nothing. The runtime treats module state as opaque, structured-clone data and keeps framework metadata beside it.

- **Memory**: isolates copies and serializes work per workspace. Tests use it.
- **SQLite**: one row per record (module slice, collection, record), and per revision, receipt, effect and journal entry. A commit writes only the rows it changed, in one transaction.
- **Postgres**: the same row layout. An advisory lock serializes commits to one workspace across hosts.
- **Snapshot**: one JSON document per workspace. The mobile host uses it.

SQLite converts an older one-document file when it opens it. The row layout is not a relational model of module state. On the hosted platform, a [workspace lease](glossary.md#workspace-lease) adds a fencing check to every Postgres commit ([hosting](hosting.md#workspace-lease-and-fence)).

Another database can back the port if it gives the same atomicity: receipts and journal entries are written in the business transaction, never after it. Agent run history is stored separately and does not replace receipts.

## Systems of record

A [system of record](glossary.md#system-of-record) cannot join the local transaction, so it is not storage. A command commits an [outbox effect](glossary.md#effect), the dispatcher delivers it afterwards, and a trusted command records the outcome. Identity and version mapping, idempotency, held effects and reconciliation belong to the [connector](glossary.md#connector)'s contract. [Systems of record](systems-of-record.md) describes the pattern.

## Surface adapters

Each surface adapter calls the instance's command and query entry points with a context the host supplies. [Architecture](architecture.md#surfaces-and-identity) lists how each surface identifies its caller.

### HTTP

The HTTP adapter checks the Host and Origin headers, and refuses a cross-origin browser write. A browser gets its session through the [launch exchange](glossary.md#launch-exchange). Errors return the error envelope with a matching status code.

[Cursors](glossary.md#cursor) are encrypted and bound to the session. A restart changes the key, so a [live query](glossary.md#live-query) takes a fresh snapshot. The event stream rechecks the session before each pull and delivers one batch per pull. Each batch is authorized and enqueued inside the storage read boundary, so a permission change cannot commit between the access check and the enqueue. An adapter forwards events through that boundary, never as a batch it authorized earlier.

### MCP

The MCP bridge serves one tool per capability over stdio. A tool call accepts only the input, an idempotency key and expected revisions, so a model cannot set trusted context. A command requires the key. Every failure is a tool error with the error envelope.

In [attached mode](glossary.md#attached-mode), the bridge reads the [connection file](glossary.md#connection-file) and calls the instance over loopback HTTP. In [embedded mode](glossary.md#embedded-mode), it runs the instance in process under a [grant file](glossary.md#grant-file), and cursors are plain journal positions because no network session exists.

### CLI

The CLI maps arguments onto the catalog; the instance decides identity and authorization. Output is JSON by default, one value per run. A failure prints the error envelope and exits with a code mapped from the error code ([exit codes](systems-of-record.md#exit-codes)).

## Adapter replacement

To move to another host, inject its identity, policy and storage, and keep the catalog and handlers. To add a surface, map requests onto the instance's raw command and query entry points (`packages/adapters/src/application-port.ts`), and keep the error envelope, revisions and authorization state. No adapter for a cloud provider ships; the ports make one a defined piece of work.

A new storage adapter passes `storageConformance` from `packages/testing`, which checks atomicity, isolation and persistence. `pgliteDriver` runs the Postgres adapter in process for it.

```sh
bun test packages/testing/test/storage.test.ts
bun test examples/project-tasks/test/transport-conformance.test.ts
```

The first runs the suite on the memory, SQLite and Postgres adapters. The second compares results and errors across the in-process, HTTP, CLI and MCP adapters.

## Related pages

- [Authorization](authorization.md): the policy port and the CASL adapter.
- [Architecture](architecture.md#host-plugins): the host ports that host plugins provide.
- [Security and compliance](security-and-compliance.md): the audit log and the egress guard.
- [Agents](agents.md): harnesses.

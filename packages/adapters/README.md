# @tortoise/adapters

`@tortoise/adapters` implements the runtime's ports for the Bun host and portable storage drivers. Import an adapter through its explicit subpath. The root entrypoint exposes the adapter contract version and does not load a database or channel implementation.

## Storage

`@tortoise/adapters/sqlite` supplies `SQLiteStorage` using Bun's SQLite driver. `PostgresStorage` is exported from `@tortoise/adapters/postgres-storage` and accepts a supplied Postgres driver. Their row layouts keep workspace records separately from execution metadata. A commit writes the changed rows inside the transaction.

Postgres commits take a transaction-scoped advisory lock for the workspace before reading its state. The hosted platform supplies a fencing check through the storage options to reject a writer that has lost its lease. The database driver's owner closes the shared driver after its users stop.

`SnapshotStorage` from `@tortoise/adapters/snapshot-storage` stores a JSON document per workspace through a supplied SQL driver. The mobile host uses that implementation. Reads and transactions on its connection are serialized. The runtime's memory storage is supplied by `@tortoise/runtime` for in-process fixtures.

Storage metadata includes the retained command results and journal entries. These commit with application state. Run history uses a separate store. The SQL row layout does not turn the application's state into a relational domain model, and runtime reads currently load workspace state.

A storage schema version mismatch refuses opening the file. Application state upgrades operate within the supported storage format and must preserve data deterministically. See [Operations and state](../../docs/capability-authoring.md#snapshots-and-storage) for application migrations and retention behavior.

Blob implementations are imported separately. `createFileBlobStore` uses a local directory; the hosted platform uses the Postgres blob store. The platform owns the lifetime of the configured store.

## Channels and policy

`@tortoise/adapters/http` exposes `createHttpHandler`. The handler validates its session and maps requests to runtime operations. The MCP and CLI adapters use the same application port; their trusted context comes from the host connection or embedded grant. The [channel contract](../../docs/interaction-contract.md) specifies their envelopes and error mappings.

A channel adapter must authorize an event at delivery inside the storage read boundary. Forwarding an earlier authorized batch would allow a permission change to intervene. The HTTP event path also binds encrypted cursors to its session; a restart requires a new snapshot.

The CASL adapter implements the supported bounded policy profile. It refuses unsupported conditions. Row scope must be applied before paging and counting, as specified in [Authorization](../../docs/authorization.md).

## Conformance

Run the storage suite from the repository root:

```sh
bun test packages/testing/test/storage.test.ts
```

That suite exercises the supplied storage fixtures, including Postgres through PGlite. It does not establish the availability or ownership behavior of a deployed database. The [hosted-instance task guide](../host/skills/run-a-hosted-instance/SKILL.md) covers host configuration and lease checks.

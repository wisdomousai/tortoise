# @agent-native/adapters

This package holds the reference [adapters](../../docs/glossary.md#adapter) behind the runtime's ports and the [surface](../../docs/glossary.md#surface) adapters that expose the [instance](../../docs/glossary.md#instance). Each surface adapter translates a request onto the raw command and query entry points. None holds business logic or its own list of capabilities, so a new [capability](../../docs/glossary.md#capability) reaches every surface.

## Layer

Framework (`packages/*`). The [host](../../docs/glossary.md#host) composes these adapters, and applications rarely import them directly. The package trusts the host for sessions and for the credentials its plugins issue.

## Primitives

- [Surface adapter](../../docs/primitives.md#surface-adapter): `createHttpHandler`, `createMcpServer`, `runCli`, `createDirectTransport`, `withSignal`, `exitCodes`.
- [Agent definition](../../docs/primitives.md#agent-definition): `createMcpServer` serves each definition as the `app://agents/<id>` resource.
- [Instance](../../docs/primitives.md#instance): `acquireWorkspaceOwnership`, `WorkspaceOwnedError`, and `acquireExclusiveLock`, the portable lock the mobile platform owns its workspace with.
- [Execution context](../../docs/primitives.md#execution-context): `readGrantFile`, `readConnection`.
- [Policy](../../docs/primitives.md#policy): the CASL adapter, `createScopedAbility`, `scopeToSql`.
- [Storage](../../docs/primitives.md#storage):
  - row storage: `RowStorage`, `RowStorageOptions`, `Retention`, `WriteStats`, `ROW_SCHEMA_VERSION`, `SqlRowsDriver`;
  - SQLite: `SQLiteStorage`, `bunSqlDriver`;
  - snapshot storage: `SnapshotStorage`, `SqlDriver`, `SqlValue`;
  - backups: `verifyBackup`, `restoreBackup`, `BackupSummary`;
  - Postgres: `PostgresStorage`, `PostgresStorageOptions`, `PG_SCHEMA_VERSION`, `PgDriver`, `PgQuery`, `PgValue`, and `bunPostgres` on `Bun.SQL`.
- [Workspace lease](../../docs/primitives.md#workspace-lease): `acquireWorkspaceLease`, `WorkspaceLease`, `LeaseOptions`, `WorkspaceLeaseLostError`.
- [Blob store](../../docs/primitives.md#blob-store): `createFileBlobStore`, the HTTP routes `POST /api/v1/blobs` and `GET /api/v1/blobs/:digest`, and blobs on the direct transport.
- [UI session context](../../docs/primitives.md#ui-session-context): `UiSessionStore`. `sendFromRun` accepts an intent from a run only for the session it captured, under the session's principal and workspace.
- [Shell port](../../docs/primitives.md#shell-port): `UiDeliveryStore` and `validDelivery` hold what accepted OS requests asked each session's frame to show.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/adapters` | server only | `adapterContractVersion`. |
| `@agent-native/adapters/*` | per row below | One adapter per file. |
| `@agent-native/adapters/http` | server only | `createHttpHandler`, sessions, `withSignal` and JSON helpers. |
| `@agent-native/adapters/mcp` | server only | `createMcpServer` and `toolInputSchema`; serves the contract, workflows and agent definitions as resources. |
| `@agent-native/adapters/cli` | server only | `runCli`, `readConnection` and `exitCodes`, for callers in other processes that attach to the running instance. |
| `@agent-native/adapters/cli-syntax` | server only | CLI words, flags and synopsis from the catalog, with no IO, so generators open no workspace. |
| `@agent-native/adapters/direct` | server only | `createDirectTransport` and `readGrantFile` for in-process callers. |
| `@agent-native/adapters/direct-transport` | any host | `createDirectTransport` alone, with no Node or Bun API, for in-process callers on mobile. |
| `@agent-native/adapters/application-port` | any host | `ApplicationPort`, the entry points every adapter calls, and `withSignal`. |
| `@agent-native/adapters/sqlite` | server only | `SQLiteStorage` and `bunSqlDriver`: row storage on `bun:sqlite`. |
| `@agent-native/adapters/snapshot-storage` | any host | `SnapshotStorage`: one JSON snapshot per workspace over any `SqlDriver`. |
| `@agent-native/adapters/row-storage` | any host | `RowStorage`: one row per record over any `SqlRowsDriver`, with retention and online backup. |
| `@agent-native/adapters/workspace-backup` | server only | `verifyBackup` and `restoreBackup` for a workspace database file. |
| `@agent-native/adapters/sql-driver` | any host | `SqlDriver`: the synchronous SQLite calls that `bun:sqlite` and `expo-sqlite` both offer. |
| `@agent-native/adapters/exclusive-lock` | any host | `acquireExclusiveLock` and `WorkspaceOwnedError`. |
| `@agent-native/adapters/blob-files` | server only | `createFileBlobStore`: blobs under a workspace directory, written to a temporary file and renamed. |
| `@agent-native/adapters/ownership` | server only | `acquireWorkspaceOwnership`: an OS-held SQLite lock, one owner per workspace. |
| `@agent-native/adapters/postgres-storage` | server only | `PostgresStorage` and `PgDriver`: the `RowStorage` row layout on Postgres, shared safely by several hosts. |
| `@agent-native/adapters/postgres-lease` | server only | `acquireWorkspaceLease` and `WorkspaceLeaseLostError`: one holder per workspace in a shared database. |
| `@agent-native/adapters/postgres-bun` | server only | `bunPostgres(url)`: a pooled `PgDriver` on Bun's built-in Postgres client. |
| `@agent-native/adapters/casl` | server only | `createScopedAbility`, `scopeToSql` and `matchesScope`: bounded CASL rules translated to memory and SQL. |
| `@agent-native/adapters/ui-sessions` | server only | `UiSessionStore`: host-issued sessions, captured context and expiring intents. |
| `@agent-native/adapters/ui-deliveries` | server only | `UiDeliveryStore`: what accepted OS requests asked each session's frame to show, per session token. |

The root script `bun run mcp` runs the MCP adapter as a stdio bridge to a running host.

## Trust boundary

### Surfaces

Surface adapters derive identity from the host session, the [connection file](../../docs/glossary.md#connection-file) or the [grant file](../../docs/glossary.md#grant-file). They never read it from the request body or tool arguments. MCP keeps transport metadata, the idempotency key and the expected revisions, outside the domain input. A model therefore cannot forge trusted context. A per-request signal only adds to the context's cancellation.

Direct and HTTP cursors carry the authorization revision they were issued under. A [live query](../../docs/glossary.md#live-query) resets when access changed after the snapshot. Errors keep their meaning across surfaces: the HTTP status, the MCP tool error and the CLI exit code map from the same error code. MCP marks a tool open-world when its capability delivers to another system through the outbox or reads one as a remote query. An agent then knows that a search leaves the process, even though it is read-only.

### HTTP credentials

`createHttpHandler` resolves a bearer token or a session cookie through its own sessions first. It then asks `authenticateToken(token, via)`, a `TokenAuthenticator` that the host fills from plugins that issue credentials. A bearer is offered as `'bearer'`. A cookie is offered as `'cookie'`, and only when there is no bearer.

A stored session created from such a credential keeps its `via`. Every recheck uses it: each request, each event-stream pull and a launch key exchange. A credential is therefore accepted only from the source it was issued for (`CredentialSource`). Cookie-authenticated writes still need a same-origin `Origin`. A token that neither step resolves is refused with `FORBIDDEN` and `details.credential: 'rejected'`, which a client tells apart from a denied request.

The host, origin and cross-site checks run before authentication. `publicRoute` runs after the Host and Origin checks and before the session check.

The session cookie is `agent_session`, or `agent_session_<port>` when the origin's port is not its scheme's default. Browsers send a host's cookies to every port on it, so two hosts on one machine, such as a fleet and a site, keep separate sessions. `sessionCookie(origin, token, maxAge)` writes the `Set-Cookie` value, with `Secure` on https, and `readSessionCookie(request, origin)` reads it. A plugin that sets its own session, such as workforce sign-in, uses both.

A session that stands for such a credential (`HostSession.credential`) can issue a launch key like any other session. The [launch key exchange](../../docs/glossary.md#launch-key-exchange) opens a browser session of its own, whose cookie is a new token. That session keeps the credential's name and rechecks it on every request and every event-stream poll. Revoking the credential, such as a paired tablet's, ends the browser session at its next request and closes its stream. A bearer credential's own event stream is rechecked the same way.

### Blobs

A blob upload is read only up to the largest size any capability declares. Its media type comes from `Content-Type`. A blob download carries `Content-Security-Policy: sandbox`, `nosniff` and `no-store`. An uploaded document therefore cannot run script on the instance's origin, and a revoked reader gets nothing from a cache. The file store accepts only `sha256:` digests as names, so no reference becomes a path outside its directory.

### Postgres and the lease

Postgres storage serializes commits to one workspace across every connection. Each commit:

1. takes a transaction-scoped advisory lock on the workspace key;
2. runs the `fence`, which is a lease's `check`;
3. reads the generation, so a cached snapshot is reused only when no other host committed.

A lease's `check` takes a share lock on the lease row inside the commit's transaction. A takeover waits for that commit. Every later commit of the old holder fails with `WorkspaceLeaseLostError` before it reads or writes. Expiry uses the database's clock, and each commit checks the lease's [fencing token](../../docs/glossary.md#fencing-token).

The database URL and its credentials are launcher configuration. `bunPostgres` connects outside the network port because the platform opens storage before any plugin. `scripts/boundary-rules.ts` lists that exemption.

### Row storage and ownership

Row, snapshot and Postgres storage write storage schema version 3 and refuse a database from another version. Version 3 renamed stored fields, so a workspace written before it is refused instead of read under the wrong names. Row storage keeps each workspace's state version stamps as `version` rows, and its `upgrade` option is a `StateUpgrade`. It keeps the last committed snapshot in memory only while the stored generation matches. A second connection's commit is therefore always reloaded. A restore removes the old write-ahead log before it renames the copy into place, so the old log's pages never replay onto the restored file. The caller of a restore must own the workspace.

Ownership never trusts PID files. A live `EXCLUSIVE` SQLite transaction is the lock, and a crash releases it. CASL scopes accept scalar columns only, and unsupported conditions fail closed. A connection file is a local credential.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/client`. External: `@casl/ability`, `@modelcontextprotocol/sdk`, `zod`. Bun's SQLite driver serves storage and ownership, and Bun's Postgres client serves `bunPostgres`.

## Tests

```sh
bun test packages/adapters
```

- `src/casl.test.ts`: CASL, memory and SQL scopes agree, and rules fail closed.
- `src/row-storage.test.ts`: a commit writes only changed rows, and the cached snapshot is dropped after a failure or another connection's commit. It also covers retention and the journal reset, refusal of older schema versions and of the other SQLite layout, backup, verification and restore, and a large-state benchmark against the document layout.
- `src/sqlite.test.ts`: a rolled-back transaction leaves the initial state untouched; blob references persist, and older documents load without them.
- `src/blob-files.test.ts`: storing, listing, reading and removing by digest; a repeated store refreshes `storedAt`; invalid digests never become paths.
- `src/http-blobs.test.ts`: upload, attach and read over HTTP with the client transport; sandboxed download headers; size and media-type refusals; blobs on the direct transport.
- `src/http-credentials.test.ts`: a cookie is offered only as a cookie and a bearer only as a bearer, on every recheck. Two hosts on different ports of one machine each set and read only their own session cookie.
- `src/ui-deliveries.test.ts`: only the session that submitted the request takes its deliveries, which expire and are revalidated and rejected when access is gone. It also covers malformed deliveries, a token reused by another principal and a full inbox.
- `src/ownership.test.ts`: one owner per workspace across processes, path aliases and a killed owner.
- `src/mcp.test.ts`: each agent definition is an MCP resource with its instructions, tool names and budgets.
- `src/cli.test.ts`: catalog-derived words and typed flags, `--json` input, dry-run, generated help, and exit codes mapped from error codes.

Postgres storage and the lease are tested in `packages/testing`, in `test/storage.test.ts` and `test/postgres-lease.test.ts`. The storage conformance suite and the PGlite driver live there. Set `STORAGE_POSTGRES_URL` to run them against a server too.

Surface parity is proven in content, where real capabilities exist. `showcase/examples/field-service/test/transport-conformance.test.ts` runs the same scenarios through direct, HTTP, CLI subprocess and MCP.

## Skills

- [run-a-hosted-instance](../host/skills/run-a-hosted-instance/SKILL.md): Postgres storage and the workspace lease behind a hosted instance, and proving a new storage adapter with the conformance suite.

## References

- [Adapters](../../docs/adapters.md)

# @agent-native/adapters

The reference adapters behind the runtime's ports and the surface adapters that expose the authority: SQLite storage, a CASL policy profile, workspace ownership, HTTP/SSE, MCP, the CLI, an in-process transport and UI sessions. Each surface is a thin translation onto the raw command and query entry points. None holds business logic or its own operation list, so adding a capability adds it to every surface.

Layer: framework (`packages/*`). The host composes these; applications rarely import them directly.

## Primitives

- [Surface adapter](../../docs/primitives.md#surface-adapter): `createHttpHandler`, `createMcpServer`, `runCli`, `createDirectTransport`, `withSignal`, `exitCodes`.
- [Agent definition](../../docs/primitives.md#agent-definition): `createMcpServer` serves each definition as the `app://agents/<id>` resource.
- [Authority](../../docs/primitives.md#authority): `acquireWorkspaceOwnership`, `WorkspaceOwnedError`.
- [Execution context](../../docs/primitives.md#execution-context): `readGrantFile`, `readConnection`.
- [Policy](../../docs/primitives.md#policy): the CASL adapter, `createScopedAbility`, `scopeToSql`.
- [Storage](../../docs/primitives.md#storage): `SQLiteStorage`, `RowStorage` (`RowStorageOptions`, `Retention`, `WriteStats`, `ROW_SCHEMA_VERSION`), `SnapshotStorage`, `SqlDriver`, `SqlRowsDriver`, `SqlValue`, `bunSqlDriver`, and `verifyBackup`, `restoreBackup` (`BackupSummary`).
- [Authority](../../docs/primitives.md#authority): `acquireExclusiveLock`, the portable lock the mobile platform owns its workspace with.
- [Blob store](../../docs/primitives.md#blob-store): `createFileBlobStore`, the HTTP routes `POST /api/v1/blobs` and `GET /api/v1/blobs/:digest`, and blobs on the direct transport.
- [UI session context](../../docs/primitives.md#ui-session-context): `UiSessionStore`.
- [Shell port](../../docs/primitives.md#shell-port): `UiDeliveryStore`, `validDelivery`: what accepted OS requests asked each session's frame to show.

The [adapter guide](../../docs/adapters.md) explains how to replace one.

## Entrypoints

Import a subpath. The root export holds only `adapterContractVersion`.

| Import                                    | Runs in     | Contents                                                                                                                                                                                        |
| ----------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/adapters`                  | server only | `adapterContractVersion`.                                                                                                                                                                       |
| `@agent-native/adapters/*`                | server only | One adapter per file, listed below.                                                                                                                                                             |
| `@agent-native/adapters/http`             | server only | `createHttpHandler`, sessions, `withSignal`, JSON helpers.                                                                                                                                      |
| `@agent-native/adapters/mcp`              | server only | `createMcpServer`, `toolInputSchema`. Serves the contract, workflows and agent definitions (`app://agents/<id>`) as resources. Also runnable as `bun run mcp` (stdio bridge to a running host). |
| `@agent-native/adapters/cli`              | server only | `runCli`, `readConnection`, `exitCodes`. Process clients attach to the running authority.                                                                                                       |
| `@agent-native/adapters/cli-syntax`       | server only | Pure CLI words, flags and synopsis from the catalog. No IO, so generators use it without a transport.                                                                                           |
| `@agent-native/adapters/direct`           | server only | `createDirectTransport`, `readGrantFile` for in-process callers.                                                                                                                                |
| `@agent-native/adapters/direct-transport` | any host    | `createDirectTransport` alone, with no Node or Bun API, for in-process callers on mobile.                                                                                                       |
| `@agent-native/adapters/application-port` | any host    | `ApplicationPort`, the surface every adapter calls, and `withSignal`.                                                                                                                           |
| `@agent-native/adapters/sqlite`           | server only | `SQLiteStorage` and `bunSqlDriver`: row storage on `bun:sqlite`.                                                                                                                                |
| `@agent-native/adapters/snapshot-storage` | any host    | `SnapshotStorage`: one JSON snapshot per workspace over any `SqlDriver`.                                                                                                                        |
| `@agent-native/adapters/row-storage`      | any host    | `RowStorage`: one row per record over any `SqlRowsDriver`, with retention and online backup.                                                                                                    |
| `@agent-native/adapters/workspace-backup` | server only | `verifyBackup` and `restoreBackup` for a workspace database file.                                                                                                                               |
| `@agent-native/adapters/sql-driver`       | any host    | `SqlDriver`, the synchronous SQLite calls `bun:sqlite` and `expo-sqlite` both offer.                                                                                                            |
| `@agent-native/adapters/exclusive-lock`   | any host    | `acquireExclusiveLock` and `WorkspaceOwnedError`.                                                                                                                                               |
| `@agent-native/adapters/blob-files`       | server only | `createFileBlobStore`: blobs under a workspace directory, written to a temporary file and renamed.                                                                                              |
| `@agent-native/adapters/ownership`        | server only | `acquireWorkspaceOwnership`: an OS-held SQLite lock, one owner per workspace.                                                                                                                   |
| `@agent-native/adapters/casl`             | server only | `createScopedAbility`, `scopeToSql`, `matchesScope`: bounded CASL rules translated to memory and SQL.                                                                                           |
| `@agent-native/adapters/ui-sessions`      | server only | `UiSessionStore`: host-issued sessions, captured context and expiring intents.                                                                                                                  |
| `@agent-native/adapters/ui-deliveries`    | server only | `UiDeliveryStore`: what accepted OS requests asked each session's frame to show, held per session token.                                                                                        |

`version` holds `adapterContractVersion`, which the root barrel re-exports. Two adapters are composers over a folder of parts that are imported only from inside the package:

- `src/http/`: sessions, sealed cursors, response headers and status codes, bounded body parsing, the pull-based event stream and the framework's authenticated routes. `http.ts` keeps the host, origin and cross-site checks and authentication, in that order.
- `src/cli/`: the connection file, argument parsing and coercion, help text, dry-run validation and execution, and text formatting. `cli.ts` keeps the dispatcher, exit codes and the main guard.

## Trust boundary

Transports derive identity from the host session, connection file or grant file, never from the request body or tool arguments. MCP keeps transport metadata (idempotency key, expected revisions) outside the domain input, so a model cannot forge trusted context. A per-request signal only adds to the context's cancellation. Direct and HTTP cursors carry the authorization revision they were issued under, so a subscription resets when access changed after the snapshot. Errors keep their meaning across surfaces: HTTP status, MCP tool error and CLI exit code map from the same code. MCP marks a tool open-world when its operation forwards to another system or reads one (`remote`), so an agent knows a search leaves the process even though it is read-only.

`createHttpHandler` resolves a bearer token through its sessions first and then through `authenticateToken`, which the host fills from plugins that issue credentials. A token neither resolves is refused with `FORBIDDEN` and `details.credential: 'rejected'`, which a client tells apart from a denied operation. `publicRoute` runs after the Host and Origin checks and before the session check.

A session that stands for such a credential (`HostSession.credential`) can mint a launch key like any other. Exchanging it opens a browser session of its own whose cookie is a new token; that session keeps the credential's name and rechecks it on every request and on every event-stream poll, so revoking the credential (a paired tablet, say) ends the browser session at its next request and closes its stream. A bearer credential's own event stream is rechecked the same way.

A blob upload is read only up to the largest size any operation declares, and its media type comes from `Content-Type`. A blob download carries `Content-Security-Policy: sandbox`, `nosniff` and `no-store`, so an uploaded document cannot run script on the authority's origin and a revoked reader gets nothing from a cache. The file store accepts only `sha256:` digests as names, so no reference becomes a path outside its directory.

Row storage keeps the last committed snapshot in memory only while the stored generation matches, so a second connection's commit is always reloaded. A restore removes the old write-ahead log before renaming the copy into place, so its pages never replay onto the restored file; the caller must own the workspace. Ownership never trusts PID files: a live `EXCLUSIVE` SQLite transaction is the lock, and a crash releases it. CASL scopes accept scalar columns only, and unsupported conditions fail closed. A connection file is a local credential.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/client`. External: `@casl/ability`, `@modelcontextprotocol/sdk`, `zod`. Bun's SQLite driver for storage and ownership.

## Tests

```sh
bun test packages/adapters
```

- `src/casl.test.ts`: CASL, memory and SQL scopes agree; rules fail closed.
- `src/row-storage.test.ts`: a commit writes only changed rows; the cached snapshot is dropped after a failure or another connection's commit; retention and the journal reset; version 1 conversion; backup, verification and restore; and a large-state benchmark against the document layout.
- `src/sqlite.test.ts`: a rolled-back transaction leaves the initial state untouched; blob references persist and older documents load without them.
- `src/blob-files.test.ts`: storing, listing, reading and removing by digest; a repeated store refreshes `storedAt`; invalid digests never become paths.
- `src/http-blobs.test.ts`: upload, attach and read over HTTP with the client transport; sandboxed download headers; size and media-type refusals; blobs on the direct transport.
- `src/ui-deliveries.test.ts`: deliveries are taken only by the session that submitted the request, expire, are revalidated and rejected when access is gone; malformed deliveries, a token reused by another principal and a full inbox.
- `src/ownership.test.ts`: one owner per workspace across processes, path aliases and a killed owner.
- `src/mcp.test.ts`: each agent definition is an MCP resource with its instructions, tool names and budgets.
- `src/cli.test.ts`: catalog-derived words and typed flags, `--json` input, dry-run, generated help and exit codes mapped from error codes.

Surface parity is proven in content, where real operations exist: `examples/project-tasks/test/transport-conformance.test.ts` runs the same scenarios through direct, HTTP, CLI subprocess and MCP.

# @agent-native/adapters

The reference adapters behind the runtime's ports and the surface adapters that expose the authority: SQLite storage, a CASL policy profile, workspace ownership, HTTP/SSE, MCP, the CLI, an in-process transport and UI sessions. Each surface is a thin translation onto the raw command and query entry points. None holds business logic or its own operation list, so adding a capability adds it to every surface.

Layer: framework (`packages/*`). The host composes these; applications rarely import them directly.

## Primitives

- [Surface adapter](../../docs/primitives.md#surface-adapter): `createHttpHandler`, `createMcpServer`, `runCli`, `createDirectTransport`, `withSignal`, `exitCodes`.
- [Authority](../../docs/primitives.md#authority): `acquireWorkspaceOwnership`, `WorkspaceOwnedError`.
- [Execution context](../../docs/primitives.md#execution-context): `readGrantFile`, `readConnection`.
- [Policy](../../docs/primitives.md#policy): the CASL adapter, `createScopedAbility`, `scopeToSql`.
- [Storage](../../docs/primitives.md#storage): `SQLiteStorage`.
- [UI session context](../../docs/primitives.md#ui-session-context): `UiSessionStore`.

The [adapter guide](../../docs/adapters.md) explains how to replace one.

## Entrypoints

Import a subpath. The root export holds only `adapterContractVersion`.

| Import                               | Runs in     | Contents                                                                                               |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------ |
| `@agent-native/adapters`             | server only | `adapterContractVersion`.                                                                              |
| `@agent-native/adapters/*`           | server only | One adapter per file, listed below.                                                                    |
| `@agent-native/adapters/http`        | server only | `createHttpHandler`, sessions, `withSignal`, JSON helpers.                                             |
| `@agent-native/adapters/mcp`         | server only | `createMcpServer`, `toolInputSchema`. Also runnable as `bun run mcp` (stdio bridge to a running host). |
| `@agent-native/adapters/cli`         | server only | `runCli`, `readConnection`, `exitCodes`. Process clients attach to the running authority.              |
| `@agent-native/adapters/cli-syntax`  | server only | Pure CLI words, flags and synopsis from the catalog. No IO, so generators use it without a transport.  |
| `@agent-native/adapters/direct`      | server only | `createDirectTransport`, `readGrantFile` for in-process callers.                                       |
| `@agent-native/adapters/sqlite`      | server only | `SQLiteStorage`, the reference snapshot store.                                                         |
| `@agent-native/adapters/ownership`   | server only | `acquireWorkspaceOwnership`: an OS-held SQLite lock, one owner per workspace.                          |
| `@agent-native/adapters/casl`        | server only | `createScopedAbility`, `scopeToSql`, `matchesScope`: bounded CASL rules translated to memory and SQL.  |
| `@agent-native/adapters/ui-sessions` | server only | `UiSessionStore`: host-issued sessions, captured context and expiring intents.                         |

`version` holds `adapterContractVersion`, which the root barrel re-exports. Two adapters are composers over a folder of parts that are imported only from inside the package:

- `src/http/`: sessions, sealed cursors, response headers and status codes, bounded body parsing, the pull-based event stream and the framework's authenticated routes. `http.ts` keeps the host, origin and cross-site checks and authentication, in that order.
- `src/cli/`: the connection file, argument parsing and coercion, help text, dry-run validation and execution, and text formatting. `cli.ts` keeps the dispatcher, exit codes and the main guard.

## Trust boundary

Transports derive identity from the host session, connection file or grant file, never from the request body or tool arguments. MCP keeps transport metadata (idempotency key, expected revisions) outside the domain input, so a model cannot forge trusted context. A per-request signal only adds to the context's cancellation. Direct and HTTP cursors carry the authorization revision they were issued under, so a subscription resets when access changed after the snapshot. Errors keep their meaning across surfaces: HTTP status, MCP tool error and CLI exit code map from the same code. MCP marks a tool open-world when its operation forwards to another system or reads one (`remote`), so an agent knows a search leaves the process even though it is read-only.

Ownership never trusts PID files: a live `EXCLUSIVE` SQLite transaction is the lock, and a crash releases it. CASL scopes accept scalar columns only, and unsupported conditions fail closed. A connection file is a local credential.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/client`. External: `@casl/ability`, `@modelcontextprotocol/sdk`, `zod`. Bun's SQLite driver for storage and ownership.

## Tests

```sh
bun test packages/adapters
```

- `src/casl.test.ts`: CASL, memory and SQL scopes agree; rules fail closed ([P3](../../docs/principles.md#p3--authority-comes-from-trusted-context-never-from-input-and-is-enforced-at-commit)).
- `src/sqlite.test.ts`: a rolled-back transaction leaves the initial state untouched ([P4](../../docs/principles.md#p4--every-write-is-a-command-to-the-single-authority-of-its-workspace)).
- `src/ownership.test.ts`: one owner per workspace across processes, path aliases and a killed owner.
- `src/cli.test.ts`: catalog-derived words and typed flags, `--json` input, dry-run, generated help and exit codes mapped from error codes.

Surface parity is proven in content, where real operations exist: `examples/project-tasks/test/transport-conformance.test.ts` runs the same scenarios through direct, HTTP, CLI subprocess and MCP.

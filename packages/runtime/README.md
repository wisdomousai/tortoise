# @agent-native/runtime

The authority: one transactional runtime per workspace that authorizes and executes commands and queries from a composed catalog. A command commits feature state, revisions, its idempotency receipt, journal entries and outbox effects together, or nothing. A query reads one authorized snapshot and returns a cursor that a caller can follow.

Layer: framework (`packages/*`). Feature state is opaque to the runtime; domains supply handlers and a policy.

## Primitives

- [Authority](../../docs/primitives.md#authority): `createApplication`, `ApplicationOptions`.
- [Module](../../docs/primitives.md#module): `sliceHandlers`, `composeAuthorization`, `authorizationRoute` compose independently authored modules into one state and policy.
- [Command](../../docs/primitives.md#command): `createHandlerFactory`, `HandlerContext`, `CommandReceipt`.
- [Query](../../docs/primitives.md#query): `QueryResult`.
- [Collection](../../docs/primitives.md#collection): `records` (`Records`), `collectionGetHandler`, `collectionListHandler`, `DEFAULT_PAGE`, and the prototype-safe `own` and `put`.
- [Remote query](../../docs/primitives.md#remote-query): `createRemoteQueryFactory`, `RemoteHandler`, `RemoteSource`, `SourceRequest`, `SourceCall`, `SourceAnswer`, and the `sources` and `remoteDeadlineMs` options.
- [Execution context](../../docs/primitives.md#execution-context): `ExecutionContext`, `DelegationGrant`.
- [Policy](../../docs/primitives.md#policy): the `AuthorizationPort` (`AuthorizationRequest`, `Decision`).
- [Storage](../../docs/primitives.md#storage): the `Storage` port, `WorkspaceSnapshot`, `createMemoryStorage`, `createWorkspaceSnapshot`.
- [Journal and live query](../../docs/primitives.md#journal-and-live-query): `ChangeEvent`, `EventBatch`.
- [Outbox effect](../../docs/primitives.md#outbox-effect): `Effect`, `EffectRequest`, `EffectOutcome`, and `enqueue`/`settleEffect` on `HandlerContext`.
- [Event log](../../docs/primitives.md#event-log): the runtime appends `command.accepted` inside the transaction and resolves commands a crash left open.

Read [architecture](../../docs/architecture.md), [authorization](../../docs/authorization.md) and [state and reactivity](../../docs/state-and-reactivity.md) for the mechanism.

## Entrypoints

| Import                    | Runs in     | Contents                                                                                                |
| ------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `@agent-native/runtime`   | server only | `createApplication`, handler factory, memory storage, composition and all types.                        |
| `@agent-native/runtime/*` | server only | One source file: `types`, `compose`, `state-equality`, `application`, `memory-storage` or `collection`. |

`src/application/` holds the parts `createApplication` wires together; import them only from inside the package. Each takes the shared `Kernel` (registry, ports, clocks, audit trail, context guard) instead of closing over it:

- `kernel.ts`: registry validation, operation resolution, the authorize-then-recheck step and output projection.
- `commands.ts`, `command-request.ts`, `command-commit.ts`: the command transaction, its request validation and fingerprint, and its journal, receipt and `command.accepted` steps.
- `remote-queries.ts`: the remote query's three steps around the source call, and the purity check on its handler steps.
- `queries.ts`, `events.ts`, `outbox.ts`, `recovery.ts`: reads, journal delivery, the host-only outbox and crash recovery of the audit log.
- `handler-context.ts`, `effects.ts`, `delegation.ts`, `audit.ts`, `records.ts`: what a handler sees, outbox transitions, grant checks, audit records and prototype-safe record writes.

Browser code may import types from here with `import type`; a value import fails `check:boundaries`.

## Trust boundary

A remote query calls `sources[target]` only between two read snapshots, never inside a transaction, and authorizes again after the source answers. Its handler steps cannot mutate state. The source's `next` cursor is returned untouched and bounded to 512 characters; an oversized or non-string cursor makes the answer malformed. Source failures become `unavailable` with a safe message; `FORBIDDEN` and cancellation propagate.

The host supplies the `ExecutionContext`. Operation input can never set or widen it, and no transport may construct it from tool arguments. Authorization, grants and cancellation are checked on entry and again before commit, after every awaited step. Rows are scoped before filtering, pagination and counts, and output is projected to readable fields before validation. A command that changes state without declaring the changed resource fails, a reused idempotency key with other input conflicts, and `expectedRevisions` makes stale writes conflict. Queries that mutate state fail. No network or model call may run while a transaction is held: handlers queue effects instead.

## Dependencies

Framework: `@agent-native/contracts`. Node: `node:crypto`. Storage and policy adapters live in [`@agent-native/adapters`](../adapters/README.md); this package names no database or rules engine.

## Tests

```sh
bun test packages/runtime
```

- `test/runtime.test.ts`: undeclared changes, lost updates, scoped idempotency, current authorization on retries.
- `test/outbox.test.ts`: effects commit with the command and are never re-enqueued on replay; delivery states.
- `test/remote-query.test.ts`: paging passes the cursor in and `next` out, even for a page that scoping emptied; a denied caller never reaches the source, a revocation during the call drops the result, policy projects the source's rows, a service answer to a caller-only query is refused, deadline and cancellation reach the source, and audit records no rows.
- `test/compose.test.ts`: modules see only their slice; unrouted operations fail closed.
- `test/collection.test.ts`: generated lists scope before filters, counts and pages; a hidden record reads as missing; writes declare their resource and conflict on a stale revision.
- `test/audit.test.ts`: a failed required append rolls the commit back; crash recovery.

The storage conformance suite that every `Storage` adapter must pass is `examples/project-tasks/test/storage-conformance.test.ts`.

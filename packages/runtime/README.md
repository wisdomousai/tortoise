# @agent-native/runtime

The authority: one transactional runtime per workspace that authorizes and executes commands and queries from a composed catalog. A command commits feature state, revisions, its idempotency receipt, journal entries and outbox effects together, or nothing. A query reads one authorized snapshot and returns a cursor that a caller can follow.

Layer: framework (`packages/*`). Feature state is opaque to the runtime; domains supply handlers and a policy.

## Primitives

- [Authority](../../docs/primitives.md#authority): `createApplication`, `ApplicationOptions`.
- [Module](../../docs/primitives.md#module): `sliceHandlers`, `composeAuthorization`, `authorizationRoute` compose independently authored modules into one state and policy.
- [Command](../../docs/primitives.md#command): `createHandlerFactory`, `HandlerContext`, `CommandReceipt`.
- [Query](../../docs/primitives.md#query): `QueryResult`.
- [Execution context](../../docs/primitives.md#execution-context): `ExecutionContext`, `DelegationGrant`.
- [Policy](../../docs/primitives.md#policy): the `AuthorizationPort` (`AuthorizationRequest`, `Decision`).
- [Storage](../../docs/primitives.md#storage): the `Storage` port, `WorkspaceSnapshot`, `createMemoryStorage`, `createWorkspaceSnapshot`.
- [Journal and live query](../../docs/primitives.md#journal-and-live-query): `ChangeEvent`, `EventBatch`.
- [Outbox effect](../../docs/primitives.md#outbox-effect): `Effect`, `EffectRequest`, `EffectOutcome`, and `enqueue`/`settleEffect` on `HandlerContext`.
- [Event log](../../docs/primitives.md#event-log): the runtime appends `command.accepted` inside the transaction and resolves commands a crash left open.

Read [architecture](../../docs/architecture.md), [authorization](../../docs/authorization.md) and [state and reactivity](../../docs/state-and-reactivity.md) for the mechanism.

## Entrypoints

| Import                    | Runs in     | Contents                                                                         |
| ------------------------- | ----------- | -------------------------------------------------------------------------------- |
| `@agent-native/runtime`   | server only | `createApplication`, handler factory, memory storage, composition and all types. |
| `@agent-native/runtime/*` | server only | One source file: `types`, `compose` or `state-equality`.                         |

Browser code may import types from here with `import type`; a value import fails `check:boundaries`.

## Trust boundary

The host supplies the `ExecutionContext`. Operation input can never set or widen it, and no transport may construct it from tool arguments. Authorization, grants and cancellation are checked on entry and again before commit, after every awaited step. Rows are scoped before filtering, pagination and counts, and output is projected to readable fields before validation. A command that changes state without declaring the changed resource fails, a reused idempotency key with other input conflicts, and `expectedRevisions` makes stale writes conflict. Queries that mutate state fail. No network or model call may run while a transaction is held: handlers queue effects instead.

## Dependencies

Framework: `@agent-native/contracts`. Node: `node:crypto`. Storage and policy adapters live in [`@agent-native/adapters`](../adapters/README.md); this package names no database or rules engine.

## Tests

```sh
bun test packages/runtime
```

- `test/runtime.test.ts`: undeclared changes, lost updates, scoped idempotency, current authorization on retries ([P3](../../docs/principles.md#p3--authority-comes-from-trusted-context-never-from-input-and-is-enforced-at-commit), [P4](../../docs/principles.md#p4--every-write-is-a-command-to-the-single-authority-of-its-workspace)).
- `test/outbox.test.ts`: effects commit with the command and are never re-enqueued on replay; delivery states ([P6](../../docs/principles.md#p6--status-reports-what-is-known-not-what-is-hoped), [P7](../../docs/principles.md#p7--other-systems-are-reached-only-through-durable-intents)).
- `test/compose.test.ts`: modules see only their slice; unrouted operations fail closed ([P8](../../docs/principles.md#p8--specialization-is-composition-and-configuration-never-a-fork)).
- `test/audit.test.ts`: a failed required append rolls the commit back; crash recovery ([P13](../../docs/principles.md#p13--the-application-reaches-only-what-it-declares-and-the-site-binds-and-records-what-it-does)).

The storage conformance suite that every `Storage` adapter must pass is `examples/project-tasks/test/storage-conformance.test.ts`.

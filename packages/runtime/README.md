# @agent-native/runtime

The authority: one transactional runtime per workspace that authorizes and executes commands and queries from a composed catalog. A command commits feature state, revisions, its idempotency receipt, journal entries and outbox effects together, or nothing. A query reads one authorized snapshot and returns a cursor that a caller can follow.

Layer: framework (`packages/*`). Feature state is opaque to the runtime; domains supply handlers and a policy.

## Primitives

- [Authority](../../docs/primitives.md#authority): `createApplication`, `ApplicationOptions`.
- [Module](../../docs/primitives.md#module): `sliceHandlers`, `composeAuthorization`, `authorizationRoute` compose independently authored modules into one state and policy.
- [Command](../../docs/primitives.md#command): `createHandlerFactory`, `HandlerContext` (with `continueWith`), `CommandReceipt` (with `continuation`), `StoredReceipt`.
- [Query](../../docs/primitives.md#query): `QueryResult`.
- [Collection](../../docs/primitives.md#collection): `records` (`Records`), `collectionGetHandler`, `collectionListHandler`, `DEFAULT_PAGE`, and the prototype-safe `own` and `put`.
- [Remote query](../../docs/primitives.md#remote-query): `createRemoteQueryFactory`, `RemoteHandler`, `RemoteSource`, `SourceRequest`, `SourceCall`, `SourceAnswer`, and the `sources` and `remoteDeadlineMs` options.
- [Execution context](../../docs/primitives.md#execution-context): `ExecutionContext`, `DelegationGrant`.
- [Agent definition](../../docs/primitives.md#agent-definition): `agentGrant` (`AgentGrantOptions`) turns a definition and its issuer's context into the run's narrowed grant.
- [Proposal](../../docs/primitives.md#proposal): `proposalHandlers` (`ProposalOptions`) serve the proposal operations over the application's `proposals` slice; accept continues with the proposed command as the accepter.
- [Proposal dataset](../../docs/primitives.md#proposal-dataset): `exportProposalDataset` reads the closed proposals a caller may see through `proposal.list`, applies the `DatasetRedaction` and returns the rows with their `sha256:` digest (`datasetDigest`), which a fine-tuned model entry names.
- [Policy](../../docs/primitives.md#policy): the `AuthorizationPort` (`AuthorizationRequest`, `Decision`), and `definePolicy` with `PolicySpec`, `OperationRule`, `IntegrationLane`, `EventRule`, `Access` and `isDelegated`.
- [Membership](../../docs/primitives.md#membership): `membershipHandler`, `membershipRule`, `roleIn`, `MembershipStore`.
- [Storage](../../docs/primitives.md#storage): the `Storage` port, `WorkspaceSnapshot`, `createMemoryStorage`, `createWorkspaceSnapshot`.
- [Journal and live query](../../docs/primitives.md#journal-and-live-query): `ChangeEvent`, `EventBatch`.
- [Outbox effect](../../docs/primitives.md#outbox-effect): `Effect`, `EffectRequest`, `EffectOutcome`, and `enqueue`, `settleEffect` (with a fencing token) and `cancelEffect` on `HandlerContext`.
- [Worker claims](../../docs/primitives.md#worker-claims): `EffectClaim`, the host-only `claimEffect` (`ClaimResult`) and `recordAttempt` (`AttemptRecord`, with `fence` and `upstream`), and the `dispatch` authorization phase checked before the first claim.
- [Reconciliation](../../docs/primitives.md#reconciliation): `effectPhase` and `EffectPhase`, the states an effect passes through and the transitions the outbox allows.
- [Blob store](../../docs/primitives.md#blob-store): the `BlobStore` port (`StoredBlob`), `BlobRecord`, `createMemoryBlobStore`, `attach` and `detach` on `HandlerContext`, `canReadResource` on the `AuthorizationPort`, the `blobStore` and `blobGraceMs` options, and `putBlob`, `readBlob`, `readEffectBlob` and `sweepBlobs` on the application.
- [Event log](../../docs/primitives.md#event-log): the runtime appends `command.accepted` inside the transaction and resolves commands a crash left open.

Read [architecture](../../docs/architecture.md), [authorization](../../docs/authorization.md) and [state and reactivity](../../docs/state-and-reactivity.md) for the mechanism.

## Entrypoints

| Import                    | Runs in     | Contents                                                                                                                                             |
| ------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/runtime`   | server only | `createApplication`, handler factory, memory storage, composition and all types.                                                                     |
| `@agent-native/runtime/*` | server only | One source file: `types`, `compose`, `state-equality`, `application`, `memory-storage`, `memory-blob-store`, `collection`, `policy`, `membership`, `proposal` or `proposal-dataset`. |

`src/application/` holds the parts `createApplication` wires together; import them only from inside the package. Each takes the shared `Kernel` (registry, ports, clocks, audit trail, context guard) instead of closing over it:

- `kernel.ts`: registry validation, operation resolution, the authorize-then-recheck step and output projection.
- `commands.ts`, `command-request.ts`, `command-commit.ts`: the command transaction, its request validation and fingerprint, and its journal, receipt and `command.accepted` steps.
- `remote-queries.ts`: the remote query's three steps around the source call, and the purity check on its handler steps.
- `queries.ts`, `events.ts`, `outbox.ts`, `recovery.ts`: reads, journal delivery, the host-only outbox and crash recovery of the audit log.
- `blobs.ts`, `blob-references.ts`, `uploads.ts`: uploads, reads, connector reads and sweeping; the reference changes a command applies at commit; and the in-memory record of recent uploads, with the lock that keeps a store write and a sweep apart.
- `handler-context.ts`, `effects.ts`, `delegation.ts`, `audit.ts`, `records.ts`: what a handler sees, outbox transitions, grant checks, audit records and prototype-safe record writes.
- `effect-claims.ts`: worker claims and the recheck of the original actor before the first claim.

Browser code may import types from here with `import type`; a value import fails `check:boundaries`.

## Trust boundary

A remote query calls `sources[target]` only between two read snapshots, never inside a transaction, and authorizes again after the source answers. Its handler steps cannot mutate state. The source's `next` cursor is returned untouched and bounded to 512 characters; an oversized or non-string cursor makes the answer malformed. Source failures become `unavailable` with a safe message; `FORBIDDEN` and cancellation propagate.

The host supplies the `ExecutionContext`. Operation input can never set or widen it, and no transport may construct it from tool arguments. Authorization, grants and cancellation are checked on entry and again before commit, after every awaited step. Rows are scoped before filtering, pagination and counts, and output is projected to readable fields before validation. A command that changes state without declaring the changed resource fails, a reused idempotency key with other input conflicts, and `expectedRevisions` makes stale writes conflict. Queries that mutate state fail. No network or model call may run while a transaction is held: handlers queue effects instead.

Blob references change only inside a command, after its handler and before the commit-phase authorization, which rechecks the context after the store lookups. An attach needs the uploader's own staged upload or read access to a resource that already references the blob; every refusal is the same `INVALID_INPUT`, so a caller cannot probe which digests exist. A read needs read access to a referencing resource within the grant's resource scope; otherwise it is `NOT_FOUND`. The store is trusted platform code and is never handed to a handler.

## Dependencies

Framework: `@agent-native/contracts`. External: `@noble/hashes` for input and blob digests. No Node or Bun API. Storage and policy adapters live in [`@agent-native/adapters`](../adapters/README.md); this package names no database or rules engine.

## Tests

```sh
bun test packages/runtime
```

- `test/runtime.test.ts`: undeclared changes, lost updates, scoped idempotency, current authorization on retries.
- `test/outbox.test.ts`: effects commit with the command and are never re-enqueued on replay; delivery states.
- `test/remote-query.test.ts`: paging passes the cursor in and `next` out, even for a page that scoping emptied; a denied caller never reaches the source, a revocation during the call drops the result, policy projects the source's rows, a service answer to a caller-only query is refused, deadline and cancellation reach the source, and audit records no rows.
- `test/compose.test.ts`: modules see only their slice; unrouted operations fail closed.
- `test/policy.test.ts`: the fixed decision order of `definePolicy` (lanes, caller gate, person-only, grant resources, container roles, both snapshots or the previous one at commit, event types), and `set-member` refusing non-managers, self-changes and reserved principals.
- `test/agent-grant.test.ts`: an agent's grant stays within the issuer's operations, resources and expiry, leaves a proposing agent's commands out, and is bound to the issuer and run.
- `test/proposal.test.ts`: accepting runs the command once as the accepter and replays its continuation; an agent grant, a viewer and a demoted accepter are refused and a changed record conflicts, each leaving the proposal open; invalid submissions, expiry and nested proposals are refused; a resource-scoped run creates its proposal through `creates` but cannot propose for, or close, a record outside its resources. The dataset export holds only decided proposals the caller may see, applies field, rationale and reason redaction before the digest, and gives the same digest for the same rows.
- `test/collection.test.ts`: generated lists scope before filters, counts and pages; a hidden record reads as missing; writes declare their resource and conflict on a stale revision.
- `test/audit.test.ts`: a failed required append rolls the commit back; crash recovery.
- `test/blobs.test.ts`: references commit with the command and only they enter the snapshot; reads follow the referencing resource, grant scope and revocation; attaching needs an own recent upload or read access; limits and declarations; a rejected command's upload is swept after the grace period while referenced and freshly stored blobs stay; connectors read an effect's blobs; audit by digest.

The storage conformance suite that every `Storage` adapter must pass is `examples/project-tasks/test/storage-conformance.test.ts`.

## Skills

- [add-capability](skills/add-capability/SKILL.md): commands, queries, policy, record shapes and triggers.

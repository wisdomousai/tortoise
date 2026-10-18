# @agent-native/runtime

The [instance](../../docs/glossary.md#instance): one transactional runtime per [workspace](../../docs/glossary.md#workspace) that authorizes and executes [commands](../../docs/glossary.md#command) and [queries](../../docs/glossary.md#query) from a composed [catalog](../../docs/glossary.md#catalog). A command commits state, revisions, its idempotency [receipt](../../docs/glossary.md#receipt), [journal](../../docs/glossary.md#journal) entries and [outbox effects](../../docs/glossary.md#effect) in one transaction, and nothing commits when any part fails. A query reads one authorized [snapshot](../../docs/glossary.md#snapshot) and returns a [cursor](../../docs/glossary.md#cursor) that a [caller](../../docs/glossary.md#caller) can follow.

## Layer

Framework (`packages/*`). Application state is opaque to the runtime. Domains supply [handlers](../../docs/glossary.md#handler) and a [policy](../../docs/glossary.md#policy). The runtime trusts the host to supply the [execution context](../../docs/glossary.md#execution-context).

## Primitives

- [Instance](../../docs/primitives.md#instance): `createApplication`, `ApplicationOptions`.
- [Module](../../docs/primitives.md#module): `sliceHandlers`, `composeAuthorization` and `authorizationRoute` compose independently authored [modules](../../docs/glossary.md#module) into one state and policy.
- [Command](../../docs/primitives.md#command): `createHandlerFactory`, `HandlerContext` (with `continueWith`), `CommandReceipt` (with `continuation`), `StoredReceipt`.
- [Query](../../docs/primitives.md#query): `QueryResult`.
- [Collection](../../docs/primitives.md#collection): `records` (`Records`), `collectionGetHandler`, `collectionListHandler`, `DEFAULT_PAGE`, and the prototype-safe `own` and `put`.
- [Remote query](../../docs/primitives.md#remote-query): `createRemoteQueryFactory`, `RemoteHandler`, `RemoteSource`, `SourceRequest`, `SourceCall`, `SourceAnswer`, and the `sources` and `remoteDeadlineMs` options.
- [Execution context](../../docs/primitives.md#execution-context): `ExecutionContext`, `DelegationGrant`.
- [Agent definition](../../docs/primitives.md#agent-definition): `agentGrant` (`AgentGrantOptions`) turns a definition and its issuer's context into the run's narrowed [grant](../../docs/glossary.md#grant).
- [Proposal](../../docs/primitives.md#proposal): `proposalHandlers` (`ProposalOptions`) serve the proposal capabilities over the application's `proposals` slice. Accepting continues with the proposed command as the accepter.
- [Proposal dataset](../../docs/primitives.md#proposal-dataset): `exportProposalDataset` reads the closed proposals a caller may see through `proposal.list` and applies the `DatasetRedaction`. It returns the rows with their `sha256:` digest (`datasetDigest`), which a fine-tuned model entry names.
- [Policy](../../docs/primitives.md#policy): the `AuthorizationPort` (`AuthorizationRequest`, `Decision`), and `definePolicy` with `PolicySpec`, `OperationRule`, `IntegrationLane`, `EventRule`, `Access` and `isDelegated`.
- [Membership](../../docs/primitives.md#membership): `membershipHandler`, `membershipRule`, `roleIn`, `MembershipStore`.
- [Storage](../../docs/primitives.md#storage): the `Storage` port, `WorkspaceSnapshot`, `createMemoryStorage`, `createWorkspaceSnapshot`.
- [Journal and live query](../../docs/primitives.md#journal-and-live-query): `ChangeEvent`, `EventBatch`.
- [Outbox effect](../../docs/primitives.md#outbox-effect): `Effect`, `EffectRequest`, `EffectOutcome`, and on `HandlerContext` the methods `enqueue`, `settleEffect` (with a fencing token) and `cancelEffect`.
- [Worker claims](../../docs/primitives.md#worker-claims): `EffectClaim`, the host-only `claimEffect` (`ClaimResult`) and `recordAttempt` (`AttemptRecord`, with `fence` and `upstream`). The `dispatch` authorization phase is checked before the first claim.
- [Reconciliation](../../docs/primitives.md#reconciliation):
  - `effectPhase` and `EffectPhase`: the phases an effect passes through and the transitions the outbox allows;
  - `reconciliationHandlers` (`ReconciliationOptions`): the held effects of every target a caller may see, and a person's decision;
  - the decision settles or releases the effect and calls the domain's `onResolved` in the same transaction.
- [Blob store](../../docs/primitives.md#blob-store):
  - the `BlobStore` port (`StoredBlob`), `BlobRecord` and `createMemoryBlobStore`;
  - `attach` and `detach` on `HandlerContext`, and `canReadResource` on the `AuthorizationPort`;
  - the `blobStore` and `blobGraceMs` options;
  - `putBlob`, `readBlob`, `readEffectBlob` and `sweepBlobs` on the application.
- [Audit log](../../docs/primitives.md#audit-log): the runtime appends `command.accepted` inside the transaction and resolves commands a crash left open.

[Architecture](../../docs/architecture.md), [authorization](../../docs/authorization.md) and [state and reactivity](../../docs/state-and-reactivity.md) explain the mechanism.

## Entrypoints

| Import                    | Runs in     | Contents                                                                   |
| ------------------------- | ----------- | -------------------------------------------------------------------------- |
| `@agent-native/runtime`   | server only | `createApplication`, the handler factory, memory storage, composition and all types. |
| `@agent-native/runtime/*` | server only | One source file from `src/`, listed below.                                 |

The source files are `types`, `compose`, `state-equality`, `application`, `memory-storage`, `memory-blob-store`, `collection`, `policy`, `membership`, `agent-grant`, `proposal`, `proposal-dataset`, `reconciliation` and `effect-phase`.

`src/application/` holds the parts `createApplication` wires together. Import them only from inside the package. Each part takes the shared `Kernel` object (registry, ports, clocks, audit trail, context guard) instead of closing over it:

- `kernel.ts`: registry validation, operation ID resolution, the authorize-then-recheck step and output projection.
- `commands.ts`, `command-request.ts`, `command-commit.ts`: the command transaction, its request validation and fingerprint, and its journal, receipt and `command.accepted` steps.
- `command-steps.ts`: the precondition check and the handler run. A precondition is checked as a read, and hidden and missing records get the same denial.
- `continuation.ts`: the command a handler continues with, run in the parent's transaction under the parent's context and receipt.
- `remote-queries.ts`: the remote query's three steps around the source call, and the purity check on its handler steps.
- `queries.ts`, `events.ts`, `outbox.ts`, `recovery.ts`: reads, journal delivery, the host-only outbox and crash recovery of the audit log.
- `blobs.ts`, `blob-references.ts`, `uploads.ts`:
  - uploads, reads, connector reads and sweeping;
  - the reference changes a command applies at commit;
  - the in-memory record of recent uploads, with the lock that keeps a store write and a sweep apart.
- `handler-context.ts`, `effects.ts`, `delegation.ts`, `audit.ts`, `records.ts`: what a handler sees, outbox transitions, grant checks, audit records and prototype-safe record writes.
- `effect-claims.ts`: worker claims, and the recheck of the original caller before the first claim.

Browser code may import types from here with `import type`. A value import fails `check:boundaries`.

## Trust boundary

### Execution context and commands

The host supplies the `ExecutionContext`. Capability input cannot set or widen it, and no [surface](../../docs/glossary.md#surface) may construct it from tool arguments. Authorization, grants and cancellation are checked on entry and again before commit, after every awaited step. Rows are scoped before filtering, pagination and counts. Output is projected to readable fields before validation.

These fail:

- a command that changes state without declaring the changed resource;
- a reused idempotency key with other input, which conflicts;
- a stale write under `expectedRevisions`, which conflicts;
- a query that mutates state.

No network or model call may run while a transaction is held. Handlers queue effects instead.

### Remote queries

A [remote query](../../docs/glossary.md#remote-query) calls `sources[target]` only between two read snapshots, outside any transaction. The runtime authorizes again after the source answers, and the query's handler steps cannot mutate state. The source's `next` cursor is returned untouched and bounded to 512 characters. An oversized or non-string cursor makes the answer malformed. Source failures become `unavailable` with a safe message, while `FORBIDDEN` and cancellation propagate.

### Blobs

[Blob](../../docs/glossary.md#blob) references change only inside a command. The change runs after the handler and before the commit-phase authorization, which rechecks the context after the store lookups. An attach needs the uploader's own staged upload, or read access to a resource that already references the blob. Every refusal is the same `INVALID_INPUT`, so a caller cannot probe which digests exist. A read needs read access to a referencing resource within the grant's resource scope; otherwise it returns `NOT_FOUND`. The store is trusted platform code, and no handler receives it.

## Dependencies

Framework: `@agent-native/contracts`. External: `@noble/hashes` for input and blob digests. No Node or Bun API. Storage and policy adapters live in [`@agent-native/adapters`](../adapters/README.md); this package names no database or rules engine.

## Tests

```sh
bun test packages/runtime
```

- `test/runtime.test.ts`: undeclared changes, lost updates, scoped idempotency, current authorization on retries.
- `test/outbox.test.ts`: effects commit with the command and are not re-enqueued on replay; delivery phases.
- `test/remote-query.test.ts`:
  - paging passes the cursor in and `next` out, even for a page that scoping emptied;
  - a denied caller does not reach the source, and a revocation during the call drops the result;
  - policy projects the source's rows, and a service answer to a caller-only query is refused;
  - deadline and cancellation reach the source, and the audit log records no rows.
- `test/compose.test.ts`: modules see only their slice; unrouted capabilities fail closed.
- `test/policy.test.ts`:
  - the fixed decision order of `definePolicy`: lanes, caller gate, person-only, grant resources, container roles, both snapshots or the previous one at commit, event types;
  - `set-member` refusing non-managers, self-changes and reserved principals.
- `test/agent-grant.test.ts`: an agent's grant stays within the issuer's capabilities, resources and expiry. It leaves a proposing agent's commands out and is bound to the issuer and run.
- `test/proposal.test.ts`:
  - accepting runs the command once as the accepter and replays its continuation;
  - an agent grant, a viewer and a demoted accepter are refused, and a changed record conflicts, each leaving the proposal open;
  - invalid submissions, expiry and nested proposals are refused;
  - a resource-scoped run creates its proposal through `creates`, but cannot propose for, or close, a record outside its resources;
  - the dataset export holds only decided proposals the caller may see;
  - the export applies field, rationale and reason redaction before the digest, and gives the same digest for the same rows.
- `test/collection.test.ts`: generated lists scope before filters, counts and pages; a hidden record reads as missing; writes declare their resource and conflict on a stale revision.
- `test/audit.test.ts`: a failed required append rolls the commit back; crash recovery.
- `test/blobs.test.ts`:
  - references commit with the command, and only they enter the snapshot;
  - reads follow the referencing resource, grant scope and revocation;
  - attaching needs an own recent upload or read access; limits and declarations;
  - a rejected command's upload is swept after the grace period, while referenced and freshly stored blobs stay;
  - connectors read an effect's blobs; audit by digest.

Every `Storage` adapter must pass `storageConformance` from [`@agent-native/testing`](../testing/README.md). `examples/project-tasks/test/storage-conformance.test.ts` checks that one workflow has the same outcomes on memory and SQLite storage.

## Skills

- [add-capability](skills/add-capability/SKILL.md): commands, queries, policy, record shapes and triggers.

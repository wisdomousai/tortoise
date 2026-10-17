# State, concurrency and reactivity

Commands change authoritative state and queries read it. Both pass through the same runtime, trusted context and current authorization. Query results are derived synchronously from local state, so there is no local projection lag. Freshness of other systems is a separate concern. Outbox effects commit with their command, and acknowledgements and imported changes come back as commands, so subscribed views update through the same journal ([task/workflow pattern](task-workflow-pattern.md)).

## A command, step by step

1. Validate input, execution context and grant.
2. In the workspace transaction, check current authorization and any expected revisions.
3. Run the handler, which changes state and declares what it changed.
4. Project and validate the output, then recheck authorization and cancellation.
5. Assign revisions and journal cursors, store the idempotency receipt, and commit.

Any failure along the way rolls everything back. A handler that changes state without declaring a changed resource fails, so no change can bypass live delivery.

Optimistic concurrency is opt-in through expected revisions. Two callers holding the same revision cannot both overwrite it. Idempotency is described in the [interaction contract](interaction-contract.md#versions-and-idempotency).

## Storage adapters

The memory adapter uses clone-on-write snapshots and serializes per workspace. The SQLite adapter stores state and metadata as one versioned document. A crash after commit but before notification keeps both the receipt and the journal entry. These adapters suit small local workspaces. The snapshot is not an indexing system, and the journal is not yet pruned.

## Queries and live views

A query returns data and the journal cursor from one snapshot, and cannot mutate state. A subscription starts at that cursor, so nothing is missed between the read and the subscribe. An unknown cursor, a restart or a very large backlog resets the view to a fresh query.

Events carry minimal references (resource, type, revision and operation), never record contents, and delivery follows current policy. A permission change increments the authorization revision. The stream then sends a generic reset, and clients clear cached views before querying again. Client caches belong to one authority, principal and grant, and are never shared across sessions.

The React bindings refetch only queries whose declared dependencies include a changed resource type, coalesce refetches, reset everything when authorization changes, and ignore responses that started before a reset. Commands show confirmed results and local pending state, not generic optimistic writes.

## Drafts and selections

Keep drafts in separate component state. A live update refreshes the record underneath, and the draft stays intact. Saving uses the revision the draft started from and shows a conflict if the record has changed since. A UI session context captures selected IDs and their revisions, and an agent run keeps the target it captured rather than following later selection changes.

## Cancellation

Cancellation stops future work and is checked before commit. It does not undo committed commands. Revoking a run revokes its authority for tool calls still in flight. After a restart, unsettled runs are marked interrupted rather than replayed. A finished stream, a finished run and a committed change are three different facts.

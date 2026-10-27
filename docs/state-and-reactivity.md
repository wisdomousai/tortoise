# State and reactivity

Commands change a workspace, queries read it, and screens stay current through the journal.

## Concepts

Terms: [snapshot](glossary.md#snapshot), [revision](glossary.md#revision), [journal](glossary.md#journal) and [live query](glossary.md#live-query).

## Commands

[Commands](glossary.md#command) and [queries](glossary.md#query) pass through the same runtime, trusted [execution context](glossary.md#execution-context) and current authorization. A command takes these steps:

1. Validate the input, the execution context and the [grant](glossary.md#grant).
2. In the workspace transaction, check current authorization, then any expected revisions.
3. Run the handler, which changes state and declares what it changed.
4. Project and validate the output, then recheck authorization and cancellation.
5. Assign revisions and journal cursors, store the [receipt](glossary.md#receipt), and commit.

Any failure rolls everything back. A handler that changes state without declaring a changed resource fails, so no change bypasses live delivery.

[Outbox effects](glossary.md#effect) commit with their command. Acknowledgements and imported changes come back as commands through the same journal ([systems of record](systems-of-record.md)).

## Revisions

A command increments the revision of each resource it declares changed. A commit gives each resource one revision and one journal entry, even when several [nested calls](glossary.md#nested-call) of the command declared it; the entry carries the type and operation of the innermost one. Optimistic concurrency is opt-in: a command names the revisions it expects, and a changed one conflicts. Two callers holding the same revision cannot both overwrite it. The authorization revision counts the workspace's policy changes.

## Snapshots and storage

A query returns its data and the journal cursor from one snapshot. A query that changes state fails. Results come from local state, so there is no projection lag.

The memory adapter gives each transaction its own copy and serializes transactions per workspace. The SQLite and Postgres adapters store one row per record and write only the rows a commit changed. The rows are not an index: a query still reads the snapshot.

Receipts and journal entries commit with the state, so a crash after commit but before notification keeps both. An optional retention limit drops old journal entries and receipts. A retry whose receipt was dropped runs again.

## Live queries

A live query follows the journal from the cursor its query returned, so nothing is missed between the read and the follow. A journal entry carries the resource, type, revision and operation ID, never record contents. Delivery includes an entry only when the caller's grant and read policy allow it. Cursors are per-workspace integers. Over HTTP each cursor becomes an encrypted string bound to the session. Clients pass the string back and do not compare or construct the string.

The stream sends a reset instead of changes when:

- the cursor is unknown, as after a host restart;
- the authorization revision changed;
- the cursor is older than the retained journal;
- the batch exceeds 256 KiB.

A client then clears its cache and queries again. The stream enqueues each batch inside the storage read boundary, so a permission change cannot commit between the check and the send. An asynchronous delivery callback is rejected.

The React bindings serve one instance, principal and grant, and never share a cache across sessions. They:

- coalesce each batch into one invalidation;
- refetch only queries whose declared dependencies include a changed resource type, or every query that declares none;
- reset everything when authorization changes;
- ignore responses that started before a reset.

Commands show confirmed results and a pending state, not optimistic writes.

## Drafts

Keep drafts in separate component state, so a live update refreshes the record underneath and leaves the draft intact. Saving sends the draft's starting revision, and a changed record shows a conflict while the draft is kept.

## Cancellation

Cancellation stops future work and is checked before commit, but does not undo committed commands. Cancelling an [agent run](glossary.md#agent-run) aborts its tool calls still in flight. A host session revoked during a request does not stop that request, a [known defect](implementation-status.md). After a restart, incomplete runs are marked interrupted rather than replayed. Only a receipt shows that a change committed; a finished stream or run does not.

## References

- [Capability authoring](capability-authoring.md)
- [Interaction contract](interaction-contract.md)
- [Agents](agents.md)
- [Authorization](authorization.md)
- [Adapters](adapters.md)

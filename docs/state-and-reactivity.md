# State and reactivity

A commit gives each changed resource a new revision and one journal entry. A query reads one snapshot of the workspace. Open screens follow the journal from that snapshot and refetch the reads the caller may still see.

## Commands

Commands and queries share the same runtime, execution context and authorization. A command's steps:

1. Validate the input, execution context and grant.
2. In the workspace transaction, check current authorization, then any expected revisions.
3. Run the handler. The handler changes state and declares what it changed.
4. Project and validate the output, then recheck authorization and cancellation.
5. Assign revisions and journal cursors, store the receipt, and commit.

Any failure rolls everything back. Changing state without declaring a changed resource fails — no change bypasses live delivery.

Outbox effects commit with their command. Acknowledgements and imported changes come back as commands through the same journal.

## Revisions

Each declared change increments the resource's revision. A commit gives each resource one revision and one journal entry, even when several nested calls declared it. The entry records the type and operation of the innermost call.

Optimistic concurrency is opt-in: a command names the revisions it expects, and a mismatch conflicts. Two callers with the same revision cannot both overwrite it. The authorization revision counts policy changes.

## Snapshots and storage

A query returns its data and the journal cursor from one snapshot. A query that changes state fails. Results come from local state — no projection lag.

Storage adapters differ in layout but share the same contract:

- **Memory** — gives each transaction its own copy, serializes per workspace
- **SQLite and Postgres** — store one row per record, write only the rows a commit changed

The rows are not an index: a query still reads the snapshot.

Receipts and journal entries commit with the state — a crash after commit but before notification keeps both. An optional retention limit drops old entries and receipts. A retry whose receipt the limit dropped runs again.

## Live queries

A live query follows the journal from the cursor its query returned and misses nothing between the read and the follow.

A journal entry includes:

- Resource, type, revision and operation ID
- Never record contents

The stream delivers an entry only when the caller's grant and read policy allow it.

Cursors are per-workspace integers. Over HTTP each cursor becomes an encrypted string bound to the session. Clients pass the string back and do not compare or construct it.

The stream sends a reset instead of changes when:

- The cursor is unknown (e.g. after a host restart)
- The authorization revision changed
- The cursor is older than the retained journal
- The batch exceeds 256 KiB

On reset, clients clear their cache and query again. The stream enqueues batches inside the storage read boundary, so a permission change cannot commit between the check and the send. It rejects an asynchronous delivery callback.

React bindings serve one instance, principal and grant and never cross sessions. On each batch they:

- Coalesce into one invalidation
- Refetch only queries whose declared dependencies include a changed resource type (or every query that declares none)
- Reset everything when authorization changes
- Ignore responses that started before a reset

Commands show confirmed results and a pending state, not optimistic writes.

## Drafts

Keep drafts in separate component state. Live updates refresh the record underneath without touching the draft. Saving sends the draft's starting revision — a changed record shows a conflict while the draft stays.

## Cancellation

Cancellation stops future work; the runtime checks it before commit. It does not undo committed commands.

- Cancelling an agent run aborts its tool calls still in flight.
- A host session revoked during a request does not stop that request — this is a [known defect](implementation-status.md).
- After a restart, the host marks incomplete runs interrupted rather than replaying them.
- Only a receipt shows that a change committed; a finished stream or run does not.

## References

- [Capability authoring](capability-authoring.md)
- [Interaction contract](interaction-contract.md)
- [Agents](agents.md)
- [Authorization](authorization.md)
- [Adapters](adapters.md)

# Operations and state

An application's capabilities declare the operations the runtime accepts. A command changes workspace state through a registered handler. A query reads a snapshot and must leave state unchanged. Each capability's browser-safe contract gives it a stable identifier and defines its input and output schemas.

The application composes its modules into the manifest and registers the matching server handlers in its application definition. The policy authorizes the operation and the records it accesses. Screens bind to the resulting catalog through the typed client. Changes belong in the application's entrypoints; adding an operation does not require modifying the starter host.

## Contract

`defineCapability` declares the operation kind and its schemas with the permission the runtime checks. Its `ui` field identifies the screen binding or explains why the capability has no screen. `defineModule` groups the declarations under a module identifier. The [interaction contract](interaction-contract.md#schemas) specifies schema restrictions and the wire representation.

Use an operation identifier that remains stable when a screen or handler is reorganized. Describe inputs in the schema so generated tools can explain them. A field hidden by policy must be optional in the output schema, allowing the projected result to validate after that field is removed.

Declare a capability's external requirements in its contract. Network destinations and child processes must pass through host ports. An operation that delivers an external write declares its integration and enqueues an effect; the dispatcher performs delivery after the local transaction. [Systems of record](systems-of-record.md) specifies the delivery contract.

## Handler

`createHandlerFactory` binds a server handler to its capability's types. The handler reads application state from `ctx.state` and runs under the host-supplied execution context. Record identifiers remain untrusted input; use an own-property lookup or the collection's record helper when accessing keyed objects.

A handler must declare every changed resource with `ctx.change(resource)`. The runtime uses these declarations to assign revisions and journal entries. A command whose authorization revision remains unchanged fails if it mutates state without any change declaration. This guard does not verify that every mutated record was declared. Resources referenced by enqueued effects and blob attachments must have change declarations. A query that changes state fails. The `records` helper performs lookup and change registration for collection operations.

Throw `ApplicationError` for an expected application refusal. Its safe message reaches the caller. An operation that changes access calls `ctx.invalidateAuthorization()` so clients cannot retain data under an obsolete authorization revision.

## Commands

The runtime validates the input and execution context before entering the workspace transaction. Within the transaction it checks current authorization and any expected revisions, then runs the handler. It projects the result through output policy and validates the projected value. Authorization and cancellation are checked again before commit.

A successful transaction stores the command result and assigns revisions to the declared resources. Its journal entries and any enqueued outbox effects commit with the state. An exception during execution or commit rolls the transaction back. Notifications occur after the commit; a process failure before notification does not remove the committed journal or result.

Network calls must not run in the transaction. An external write uses the outbox. A declared remote query uses the separate remote-query execution path and reauthorizes returned data before release.

## Revisions

Each changed resource receives one new revision per command transaction, including when nested operations change the same resource. Its journal entry identifies the operation and type of the innermost call that declared the change.

Optimistic concurrency applies when the caller supplies expected revisions. A mismatch returns `CONFLICT` before a handler can overwrite the newer record. A command that omits expected revisions does not receive that check. The authorization revision tracks access changes independently of record revisions.

## Nested calls

A command can invoke another operation inside its transaction with `ctx.invoke` or `ctx.query`. The caller declares the permitted callees in `invokes`; `invokes: 'any'` permits a command to choose a registered operation from its input. The runtime validates and authorizes each nested operation under the same caller context. Its changes become part of the outer command's transaction.

The catalog rejects unknown targets, invocation cycles, a query that invokes a command, and a chain deeper than four. Execution also rejects re-entry, more than 64 calls, parallel calls and calls left unawaited. Await a nested call before starting the next. A refused nested call fails the transaction even if application code catches its error.

## Collections

A collection declares a keyed record schema and the metadata used to present it. The collection helpers generate reads and commands over that declaration. Server handlers supply storage access and application validation, including normalization and uniqueness rules.

`collectionList` can declare equality filters on stored fields. Each filter becomes an optional input. Its `sort` declaration names allowed fields and adds `sortBy` and `sortDirection`; the handler's ordering applies when the caller supplies none and breaks ties. A declared search input uses the handler's `searchText` function. Filtering and authorization must happen before the handler counts or pages rows.

`collectionUpdate` makes the selected input fields optional. A field omitted from input stays unchanged. An item field whose schema permits absence also accepts `null` in the update, which removes the stored field. A required item field cannot be cleared this way.

The collection's display metadata determines labels and field presentation in generated screens and tools. Explicit field kinds support date inputs and status tones, as well as record references and file fields. The [catalog contract](interaction-contract.md#catalog) defines validation and the consumers of this metadata.

## Snapshots and storage

A local query returns data and its journal cursor from the same snapshot. The data reflects committed local state without a separate projection stage. Storage adapters share this contract despite their different layouts.

Retention can limit stored journal entries and command results. Retrying an idempotency key after its result has been removed executes the operation again. Applications must choose retention with that consequence in mind. The fingerprint and replay checks are specified in [Versions and idempotency](interaction-contract.md#versions-and-idempotency).

When a stored shape changes, add a deterministic step to the application's `StateMigrations`. The migration runs against the persisted state; normal handlers should not accumulate compatibility reads for retired shapes. The kernel also provides an explicit `migrate` command that checks a copy before replacing a local database.

## Live queries

A live query follows the journal from the cursor returned by its snapshot. This handoff covers commits made after the snapshot and before the subscription begins. A journal entry contains its resource identifier and revision with the operation that changed it; it carries no record contents.

The event stream filters entries using the caller's grant and current read policy. Authorization and enqueueing occur inside the storage read boundary, preventing a permission change from committing between those steps. The delivery callback must be synchronous.

Cursors are per-workspace integers internally. HTTP exposes encrypted strings bound to the session. Clients return these strings unchanged. They cannot construct them or infer ordering from their text.

A stream resets when the cursor is unknown, the authorization revision changes, the requested history has been removed, or the event batch exceeds 256 KiB. A host restart can invalidate a session's cursor. On reset the client clears cached results and reads a fresh snapshot.

React bindings belong to one instance and its caller session. They coalesce a batch into one invalidation and refetch queries whose dependencies include a changed resource type. A query with no declared dependencies is invalidated by every change. A reset invalidates all queries and fences responses that started before it. Command UI shows pending execution until it receives a confirmed result.

## Drafts

Keep an editing draft in component state separate from the live record. A live refresh can update the record while preserving the person's draft. Submit the revision from which the draft started. If the record has changed, retain the draft and show the conflict so the person can resolve it.

## Cancellation

The runtime checks cancellation before committing. A cancelled command contributes no new transaction after that check. Cancellation cannot reverse a transaction that has already committed.

Cancelling an agent run aborts its in-flight tool calls. Session revocation or expiry can abort the request at the runtime's next check; a plugin credential can also abort its signal. After restart, incomplete runs become interrupted and are not replayed automatically. A command result establishes whether a change committed; completion of a progress stream does not establish that result.

## Declared workflows

`defineWorkflow` declares a sequence whose steps may continue after the starting command returns. Its module lists the workflow and the application composes the workflows plugin. `step.run` executes a command, while `step.wait` checks a query until its declared condition is met. Waits declare a watched resource or a recheck interval and have a bounded timeout.

Bindings read workflow input with `from.input` and prior step results with `from.step`. `from.effect` reads an awaited effect outcome; `from.result` reads the query result inside a wait. The catalog rejects forward references and invalid durations. Steps run as the person who started the workflow. A compensation command can reverse application work when a later step fails permanently.

A command starting a workflow declares `workflow.start` in `invokes` and supplies a business key. The framework keeps one workflow instance per key. A nested call is suitable when all changes must commit within the current transaction. An automation trigger starts work from a committed change or a schedule under its issued grant; it does not itself declare a workflow sequence.

## Scenarios

Behavioral scenarios should check the permission boundary and the operation's actual state transition. Include stale-revision handling when the command uses revisions, and verify idempotent replay where a caller retries. Cross-channel scenarios from `@tortoise/testing` can exercise the same behavior through the configured adapters. Update an agent's scenarios when its permitted operations or their behavior change.

The [add-capability skill](../packages/runtime/skills/add-capability/SKILL.md) provides the authoring procedure. [Development and testing](development-and-testing.md) lists the available checks.

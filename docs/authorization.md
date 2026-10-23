# Authorization

The [instance](glossary.md#instance) decides who may run which [capability](glossary.md#capability) on which records, and checks it inside the transaction.

## Concepts

Terms: the [principal](glossary.md#principal), the [container](glossary.md#container), [membership](glossary.md#membership), the [policy](glossary.md#policy), the [grant](glossary.md#grant) and delegated grant, and field projection.

## Execution context

Every command and query reaches the instance with an [execution context](glossary.md#execution-context) that the host derives from the [session](glossary.md#session). The screens, HTTP, MCP, the CLI and agent tools reach the same handlers and policy. Capability input cannot choose the principal, workspace, roles or grant. The local reference host starts as the [local owner](glossary.md#owner), and test hosts can create isolated sessions.

A provider account grants no workspace access. An approval never permits an operation the policy denies.

## Command checks

The runtime checks a command in this order (`packages/runtime/src/application/commands.ts`):

1. Validate the input and the context: workspace, principal, cancellation, and the grant's operations, expiry and bindings.
2. In the storage transaction, ask the policy on the current state. An expected [revision](glossary.md#revision) counts as a read of its resource.
3. Run the handler. A change to a resource outside the grant is refused.
4. Project and validate the output.
5. Ask the policy again, on the state before the command and on the proposed state.

The context, cancellation included, is checked again after every awaited step and before the commit. Any failure rolls the whole command back.

A [nested invocation](glossary.md#nested-invocation) (`ctx.invoke`, `ctx.query`, `continueWith`) takes steps 1 to 5 for its own operation under the same context. The grant must list that operation, and the calling capability must list it in `invokes`. The policy request carries `via`, the enclosing operations, outermost first, at the `invoke`, `commit` and `replay` phases. A refusal fails the whole command, even when the calling handler catches it. A query is authorized again after projection. `packages/runtime/test/runtime.test.ts` covers the rechecks.

## Policy port

The policy receives the trusted context, the capability, the validated input and the current state, and at commit the previous state. In field projection, it reduces each output to the fields the caller may read. It also decides whether a journal entry may be delivered. Its rules resolve records from authoritative state. The runtime itself checks the grant and the resources a command changes.

In the `project-tasks` example, workspace owners administer projects, project owners administer theirs, editors edit tasks and viewers read. An archived project rejects task edits. Only owners see private notes and membership. Response schemas make those fields optional, so a projected response still validates.

## Declarative policies

`definePolicy` builds the policy port from data and denies any operation it does not list. Each example lists every operation it serves as one of these:

- `open`: the handler scopes the rows.
- `integration`: only a [policy lane](glossary.md#policy-lane) may call it.
- A rule: it resolves the container from authoritative state and names the roles allowed. It can also name the resource a limited grant must contain, and refuse a delegated run.

It evaluates a command on both the current and the proposed state, so a rule cannot forget the commit-time check (`packages/runtime/test/policy.test.ts`). Roles come from a membership, whose `set-member` command refuses a change to the caller's own role.

## Feature policies

A [feature](glossary.md#feature)'s operations and resource types are decided by the feature's own policy (`routeAuthorization` in `packages/runtime/src/compose.ts`). The application's policy never sees them, so its `caller` gate and [policy lanes](glossary.md#policy-lane) do not apply. The feature's policy reads an access view that the application computes from its own state, and the view applies the application's membership, its integration principals' lanes and a delegated grant's resource scope. A command is checked against the access views of the current and the previous state.

Person-only rules sit in the feature's policy, so every application gets them: approving or rejecting an [approval request](glossary.md#approval-request) and resolving a held effect refuse a delegated caller. A caller who cannot read an approval request gets `NOT_FOUND` for it, not a refusal that confirms it exists.

`packages/runtime/test/approval-feature.test.ts` covers the approval feature's policy over an access view. Each migrated example's `test/migration.test.ts` refuses its integration principals and non-members on the feature's operations.

## Lists

A list is scoped to what the caller may see before it is filtered, sorted, paged or counted (`packages/runtime/test/collection.test.ts`). Protected fields cannot be used to filter or sort, because the query schema does not accept them. In the examples, a delegated grant narrows lists and single-record reads further. Dictionary lookups check own properties, so a name like `constructor` never matches by accident.

## Delegation and replay

Effective access is the principal's current policy intersected with the grant. A grant can limit operations, resource IDs and lifetime, and can be bound to a principal, workspace and run. An [agent run](glossary.md#agent-run) keeps the grant it started with, and tool arguments cannot change it.

A grant scoped to resources may change only those records. Its `creates` list lets it add records of a named type, which a run cannot name before they exist. A requesting agent on a selection gets `creates: ['approval-request']`, and `approval.request` refuses an [approval request](glossary.md#approval-request) outside the selection.

A retry with the same [idempotency key](glossary.md#idempotency-key) returns the stored [receipt](glossary.md#receipt) after current authorization and projection, without running the handler again. The receipt records the nested commands with their inputs, and the retry authorizes each of them again in the `replay` phase with its `via`. A revoked record, a newly restricted field or a lost nested operation therefore cannot be recovered through an old receipt.

Before the [dispatcher](glossary.md#dispatcher) first claims an [outbox effect](glossary.md#effect), the person who committed it is authorized again in the `dispatch` phase. The check runs without the delegation the command ran under. `definePolicy` answers it from containers and roles only, because the command's preconditions no longer hold after it committed. A denial holds the effect for a person. Later claims are not rechecked, so a target's answer is still recorded, and the principal who lost access does not see it (`packages/integration/test/reliability.test.ts`).

## Revocation

Membership changes serialize with business changes. An authorization event increments the authorization revision in the same commit. A grant's expiry and bindings and a run's cancellation are rechecked after every awaited step. A session revoked while its command waits is not, and the command still commits; the [ledger](implementation-status.md#known-defects) lists this defect. A remote policy system needs its own revocation contract, because the composition promises no atomic revocation across systems.

## Live updates

Replay and live delivery both follow current access. [Journal](glossary.md#journal) entries carry references and revisions, not record contents. Delivery is filtered inside the storage read boundary, so a membership change cannot commit in between. The HTTP surface revalidates the session at delivery and binds cursors to it ([adapters](adapters.md#http)).

When the authorization revision changes, the stream resets without revealing newly forbidden IDs. A [live query](glossary.md#live-query) drops old data, keeps processing revocations while it refreshes, and ignores stale responses. Bytes already delivered cannot be withdrawn, so screens hide sensitive drafts after a revocation.

## UI session context

A [UI session context](glossary.md#ui-session-context) carries ephemeral navigation and selection, separate from business commands. The host creates each one and binds it to the live credential, principal and workspace. A selection is checked against authorized queries, and capturing it for a run freezes its IDs and revisions. Updates are versioned, so a late validation cannot overwrite a newer selection.

UI intents are bounded, expire, are offered until acknowledged, and end as accepted, rejected or expired. A leaked session ID alone grants nothing, and no intent operation commits business records.

## Process boundary

The instance owns the [workspace](glossary.md#workspace). Other processes attach through its protected [connection file](glossary.md#connection-file) and never open a second writable copy. An exclusive OS lock guards the workspace, including through path aliases, and a crash releases it (`packages/adapters/src/ownership.test.ts`). Another process running as the same OS user is not sandboxed.

## CASL adapter

The CASL [adapter](glossary.md#adapter) keeps CASL syntax out of capability descriptors. It accepts equality, membership and boolean conditions over registered scalar fields:

```ts
{ eq: ['projectId', 'p1'] }
{ in: ['projectId', ['p1', 'p2']] }
{ and: [scopeA, scopeB] }
{ or: [scopeA, scopeB] }
{ not: scopeA }
```

- **Fields**: each field has a column, a scalar type and nullability. Equality is strict, and a missing property does not equal null.
- **Fail closed**: unknown fields, values, operators and unsafe column names are rejected. Values become SQL parameters, and nullable comparisons avoid SQL's implicit unknown.
- **Rule order**: denies take precedence and are part of the computed scope. The adapter rejects an allow after a deny, wildcard subjects and actions, and field-specific rules in a row scope.
- **Immutability**: rules and scopes are copied, so a validated policy cannot be changed.

It is not a general CASL-to-SQL translator. A new codebase supplies explicit mappings, and agreement tests show that its results match the object decisions. A new operator needs agreement tests across object, memory and SQL evaluation before it is used (`packages/adapters/src/casl.test.ts`).

## Tests

```sh
bun test packages/runtime/test packages/adapters/src/casl.test.ts
bun test examples/project-tasks/test/security-conformance.test.ts
```

## References

- [State and reactivity](state-and-reactivity.md)
- [Systems of record](systems-of-record.md#worker-claims)
- [Adapters](adapters.md)
- [Architecture](architecture.md#instances-and-hosts)

# Authorization

Every command and query enters the runtime with an execution context derived by the host. HTTP, MCP, the CLI, UI bindings and agent tools all reach the same handlers and policy, and domain input cannot choose the principal, workspace, roles or grant. The local reference host starts as the principal `owner`, and test hosts can mint isolated sessions.

Authentication, authorization, provider funding and approval are separate concerns. A provider account grants no workspace access, and an approval never permits an action that is otherwise denied.

## Where access is checked

- Before the handler runs: input validation and operation access.
- While the handler runs: the policy resolves the records involved from authoritative state.
- Before a command commits: current and proposed state, after output projection. Queries recheck after projection.
- After any awaited work: cancellation, grant expiry and grant bindings, again.

Any failure rolls the whole command back. An operation without a policy is denied.

In the `project-tasks` example, workspace owners administer projects, project owners administer theirs, editors edit ordinary tasks and viewers read. An archived project rejects task edits, and only owners see private notes and membership. Response schemas make protected fields optional, so a projected response still validates.

## Declarative policies

`definePolicy` builds the policy port from data. Each example lists every operation it serves: `open` (the handler scopes rows), `integration` (only an integration lane may call it), or a rule that resolves the container from authoritative state and names the roles, the resource a limited grant must name, and whether a delegated run is refused. The builder decides in a fixed order and evaluates commands on both the current and the proposed state, so a rule cannot forget the commit-time check. Roles held in a container come from a [membership](primitives.md#membership), whose `set-member` command refuses changes to your own role.

## Lists

A list is scoped to what the caller may see before it is filtered, sorted, paged or counted. Protected fields cannot be used to filter or sort, because the query schema does not accept them. A delegated grant narrows lists and single-record reads further. Dictionary lookups check own properties, so a name like `constructor` never matches by accident.

## The CASL adapter

The adapter keeps CASL syntax out of capability descriptors and accepts a small scope language:

```ts
{ eq: ['projectId', 'p1'] }
{ in: ['projectId', ['p1', 'p2']] }
{ and: [scopeA, scopeB] }
{ or: [scopeA, scopeB] }
{ not: scopeA }
```

- **Fields.** Each field is registered with a column, a scalar type and nullability. Equality is strict, and a missing property does not equal null.
- **Fail closed.** Unknown fields, values, operators and unsafe column names are rejected. Values become SQL parameters, and nullable comparisons avoid SQL's implicit unknown.
- **Rule order.** Denies take precedence. The adapter rejects a rule order that would reverse that, wildcard subjects and actions, and field-specific rules in a row scope.
- **Immutability.** Rules and scopes are copied, so a validated policy cannot be mutated afterwards.

It is not a general CASL-to-SQL translator. A new repository supplies explicit mappings and shows, through agreement tests, that its results match the object decisions.

## Delegation and replay

Effective access is the principal's current policy intersected with the grant. A grant can limit operations, resource IDs and lifetime, and can be bound to a principal, workspace and run. An agent run keeps the grant it started with, and tool arguments cannot change it.

A retry with the same idempotency key returns the stored receipt after current authorization and projection, without running the handler again. A revoked record or a newly restricted field therefore cannot be recovered through an old receipt.

Membership changes serialize with business changes, and an authorization event increments the authorization revision atomically. Cancellation is checked at commit. A remote policy system needs its own revocation contract; the kernel promises no distributed atomic revocation.

## Subscriptions and caches

Replay and live delivery both follow current access. Journal entries carry references and revisions, not record contents. Delivery runs inside the read boundary, so a membership change cannot commit in between, and the host revalidates the session at delivery. Cursors are opaque and bound to their session.

When the authorization revision changes, views reset without revealing newly forbidden IDs. The client drops old data, keeps processing revocations while it refreshes, and ignores stale responses. Bytes already delivered cannot be withdrawn, so screens hide sensitive drafts after a revocation.

## UI sessions

UI sessions carry ephemeral navigation and selection, separate from business commands. The host creates each session and binds it to the live credential, principal and workspace. A selection is checked against authorized queries, and capturing it for a run freezes its IDs and revisions. Updates are versioned, so a late validation cannot overwrite a newer selection.

UI intents are bounded, expire, replay until acknowledged, and end as accepted, rejected or expired. A leaked session ID alone grants nothing, and no intent operation commits business records.

## Process boundaries

The authority owns the workspace. Other processes attach through its protected connection file and never open a second writable copy. An exclusive OS lock guards the workspace, including through path aliases, and crash recovery relies on the lock's release. Another process running as the same OS user is not sandboxed.

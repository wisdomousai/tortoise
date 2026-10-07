# Authorization

Every business command and query enters the application runtime with a host-derived `ExecutionContext`. HTTP, MCP, CLI, UI bindings and agent tools call the same handlers and policy port. A request cannot select its principal, workspace, roles or delegation grant through domain input. The local reference host starts as principal `owner`; test hosts can mint isolated sessions.

Authentication, application authorization, provider funding and approvals have separate responsibilities. A provider account does not grant workspace access. An approval never permits an otherwise denied action.

## Enforcement points

The runtime validates the input and checks operation access before invoking its handler. The feature policy resolves referenced records from authoritative state. Commands check current and proposed state before commit, after output projection; queries recheck access after projection. Cancellation, grant expiry and grant bindings are checked again after awaited work. Authorization failures, invalid outputs and revision conflicts roll back the whole command.

The project/task example uses CASL object decisions for accessible projects, editable projects and protected task fields. Workspace owners can administer projects; project owners can administer their project; editors can edit ordinary tasks; viewers can read. Archived projects reject task edits until restored. Only owners can read or write `privateNote` or read the membership map. Response schemas make those protected fields optional so projected output remains valid. Unknown operations have no policy and are denied.

List handlers apply the feature's authorized scope before filtering, ordering, pagination and counts. A caller cannot sort or filter by `privateNote`: those fields are absent from the accepted query schema. Delegated resource restrictions further narrow lists and individual-record access. Dictionary lookups use own properties so names such as `constructor` cannot become accidental membership.

## CASL adapter profile

`packages/adapters/src/casl.ts` keeps CASL syntax outside capability descriptors. It accepts a small private scope representation:

```ts
{ eq: ['projectId', 'p1'] }
{ in: ['projectId', ['p1', 'p2']] }
{ and: [scopeA, scopeB] }
{ or: [scopeA, scopeB] }
{ not: scopeA }
```

Fields must have a registered SQL column, scalar type (`string`, `number` or `boolean`) and explicit nullable flag. Equality is strict scalar equality; null is explicit, and missing object properties do not equal null. Repository objects and SQL columns must use the same normalized field representation. Unsupported fields, values, operators and unsafe SQL column identifiers fail closed. SQL values are parameters. Nullable comparisons use two-valued results so negation does not acquire SQL's implicit unknown behavior.

All allows for an action/subject precede its denies. The adapter rejects a later allow that would reverse deny precedence. It also rejects CASL's `manage` and `all` wildcard conventions and field-specific rules when generating a row scope. Row visibility requires an explicit field-independent read rule. Field rules remain available for per-instance field checks. Rule inputs and returned scopes are copied so callers cannot mutate a previously validated policy.

The adapter is not an arbitrary CASL-to-database translator. A new repository supplies explicit mappings and proves its scoped results agree with CASL object decisions. Equality/membership/boolean scope tests compare CASL, in-memory predicates and SQLite results, including nulls, overlapping grants and denial.

## Delegation and replay

Effective access is current principal policy intersected with the grant. Grants can constrain operations, resource IDs and expiry and can bind a principal, workspace and run. The host captures the initiating grant for an agent run and never replaces a narrowed grant with all operations. Tool arguments cannot alter that captured authority.

Idempotency keys are scoped to workspace and principal. Fingerprints include validated input, expected revisions, operation, application contract version, run and grant context. A matching retry returns its receipt after current authorization and output projection. A different request or delegation binding conflicts. Replays do not rerun the handler; revoked records and newly restricted fields cannot be recovered through a saved receipt.

The local storage boundary serializes authorization-related membership changes with business changes. An `authorization.changed` event increments the authorization revision atomically. Run cancellation also supplies an abort signal checked at the commit boundary; committed commands remain committed. Remote policy systems need their own consistency/revocation contract—the kernel does not promise distributed atomic revocation.

## Subscriptions and caches

Event authorization applies to replay and live delivery. Journal records contain resource references and revisions, not record snapshots. The local authority's synchronous delivery callback runs while its storage read boundary excludes membership-change commits. The HTTP host revalidates the live session at delivery. Opaque authenticated cursors bind replay to its session and hide internal journal sequence counts.

A changed authorization revision resets subscribed views without returning newly forbidden IDs. The client clears old data immediately, continues consuming revocations while refreshes are pending, and rejects responses from stale generations. Already delivered bytes cannot be withdrawn. Applications must keep sensitive drafts out of rendering after revocation; ordinary dirty drafts remain separate from committed query data.

## UI sessions

`UiSessionStore` provides ephemeral routing separately from business commands. The host generates each UI session ID and binds it to the live host credential, principal and workspace. Injected validation ports resolve selected resources through authorized queries and validate intent targets. Capture revalidates current access and returns an immutable selection/revision snapshot; later UI selection changes cannot retarget it. Updates have versions, and delayed validation cannot overwrite a newer selection.

Intents are bounded, expire, replay until acknowledged, and distinguish accepted, rejected and expired states. A leaked UI session ID alone grants no access. Registering, polling or acknowledging an intent never commits business records. Host routes must supply validated contexts and keep their registration/heartbeat lifecycle current.

## Boundaries

The authority owns the workspace; process clients use its protected connection file and never independently open a writable copy. The SQLite control database holds an exclusive OS lock, including across aliases of the same canonical path. Crash recovery relies on lock release, not PID-file stealing. Running another local process under the same OS user is not a filesystem security sandbox.

The reference SQLite business adapter stores JSON-safe feature state, receipts and journal in one transaction. It explicitly rejects unsupported values instead of losing them during serialization. Applications can replace it with feature repositories sharing one transaction-bound unit of work; no universal record table or ORM is required.

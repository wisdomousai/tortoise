# Authorization

The runtime authorizes a capability against the workspace state under which it executes. Application policy determines access to its records. The execution context supplied by the host identifies the caller and any delegated grant. Every channel reaches this runtime boundary.

## Write a policy

`definePolicy` compiles a `PolicySpec` into an `AuthorizationPort`. The policy declares the operations it decides and the resource types whose journal events it can release. An operation absent from that declaration is denied.

An operation marked `open` admits callers that pass the policy's caller gate; its handler remains responsible for authorized row scope. An operation marked `integration` admits only an integration principal whose allowlist names it. An `OperationRule` can resolve a container from stored state and check the caller's membership there. Its `allow` function can impose additional conditions on the current operation input.

An integration principal is confined to its allowlist. The policy checks this path before the ordinary caller rules. Configure an allowlist's additional predicate when an integration must act only on a particular station or target. Journal access for that principal can be constrained with its event predicate.

At commit, an ordinary operation rule evaluates the prior state as well as the proposed state. `commit: 'previous'` restricts this evaluation to the prior state when a command removes the resource needed by its rule. A rule's `person` flag refuses a context with a grant or run. Resource-limited grants require the rule to resolve a resource included in that grant.

The declarations and evaluation order are implemented in `packages/runtime/src/policy.ts`. [Operations and state](capability-authoring.md) describes the handler contract.

## Who the caller is

The host constructs `ExecutionContext` from a validated session or other configured identity source. Capability input cannot establish the caller's principal or widen its grant. The local-user host issues the local identity; workforce sign-in and device enrollment have their own credential paths.

A provider account authorizes access to that provider. Workspace policy continues to govern the resulting agent's operations. Approval also executes under current application policy.

## Command checks

The runtime validates the request and execution context before opening the storage transaction. Inside the transaction it asks the policy to authorize against current state and checks expected revisions. Supplying an expected revision requires read access to the referenced resource.

The handler then executes within the transaction. Changes outside a delegated grant's resource scope fail. The runtime projects the returned value through output policy and validates the projected output schema. Before committing, it checks authorization against the relevant state snapshots again and rechecks cancellation and grant validity. A failure aborts the transaction.

Each nested invocation runs its own authorization. The enclosing capability must declare the callee in `invokes`, and the caller's grant must permit it. Policy receives the enclosing operation path as `via`. A nested refusal fails the transaction even when handler code catches that error.

A policy can remove unreadable fields from the response. The declared output schema must permit those fields to be absent so the projected value still validates. The same authorization port controls journal visibility. Runtime command ordering is implemented in `packages/runtime/src/application/commands.ts` and its frame helpers.

## Feature policies

A mounted feature authorizes its own operations through the access view supplied by the application. `routeAuthorization` in `packages/runtime/src/compose.ts` routes each request to the unit that owns it. The application's policy does not receive the feature's operations.

The access view must apply the application's membership and relevant grant scope. Approval decisions and reconciliation require a person under their feature policies. A caller without access to an approval request receives `NOT_FOUND`, so the refusal does not confirm that a hidden request exists.

## Lists

A list handler restricts records to the caller's authorized scope before it filters or orders the result. Paging and total counts use that same scope. Protected fields cannot become search or ordering inputs that expose information the caller cannot read. A delegated grant further restricts the available records.

## Delegation and replay

A delegated operation must satisfy current policy within its grant. A grant can constrain the operations and resource identifiers available to the run. It can also bind execution to a principal or workspace and impose an expiry. A resource-scoped grant's `creates` field permits new resources of the declared types. The agent definition establishes the run's starting grant.

Replaying an idempotency key reauthorizes the stored result under current access. The runtime also reauthorizes the nested commands recorded by the first execution and projects the returned value again. A stored command result therefore cannot restore revoked read access.

Before an outbox effect's first claim, the default dispatcher requests a dispatch authorization check for its original actor without delegation. For `definePolicy`, the dispatch phase checks membership and role scope without re-evaluating the command's application preconditions on its already-changed state. A denied dispatch check holds the effect for reconciliation.

## Revocation and live updates

Membership changes serialize with record changes and increment the authorization revision. The runtime checks grant expiry and run cancellation after awaited work. Session revocation while a command is already waiting remains a [known defect](implementation-status.md#known-defects); the runtime context does not currently prevent that command from committing solely because its session was revoked.

The journal stores resource references and revisions. Event delivery applies current read access inside the storage read boundary. A change to the authorization revision resets subscriptions without returning newly forbidden resource identifiers. Live queries discard data obtained under the prior authorization revision. Screens must also clear sensitive drafts because access checks cannot retract data already delivered to a caller.

## UI sessions

A UI session binds its navigation and selection to the credential that created it. The host checks that the selected resources are readable. A run captures a particular context version, and its later intents remain bound to that session. Possessing the session identifier does not establish permission to use it. The shared validation contract is specified in [Channels and interaction](interaction-contract.md#ui-session-context).

## Process boundary

A local serving instance owns the workspace through an exclusive OS lock. Other processes attach through the connection file. Hosted ownership uses a database lease. These ownership controls serialize workspace access; processes running as the same OS user are outside this application-level authorization boundary.

## CASL adapter

The CASL adapter supports a bounded condition language over registered scalar fields. Equality and set membership use `eq` and `in`. Boolean composition uses `and`, `or` and `not`. The adapter parameterizes values when compiling its SQL scope.

Unknown fields and unsupported operators are rejected. Unsafe column names and wildcards are refused, and deny rules take precedence. Extending the supported language requires agreement checks across object evaluation and the storage adapters. Run these checks from the repository root:

```sh
bun test packages/runtime/test packages/adapters/src/casl.test.ts
```

The storage and event boundary is described in [Architecture](architecture.md#channels-and-identity). Outbox claim authorization is described in [Systems of record](systems-of-record.md#worker-claims).

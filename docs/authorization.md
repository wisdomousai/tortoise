# Authorization

The instance decides who may run which capability on which records, and checks it inside the storage transaction. Screens, HTTP, MCP, the CLI and agent tools all hit the same check.

## Write a policy

`definePolicy` builds the policy from data and denies every operation it doesn't list. Abridged from `showcase/examples/receiving/policy.ts`:

```ts
const editor: OperationRule<AppState, Role> = {
  allow: ({ state, context }) => roleOf(state, context.principalId) === 'editor',
};

export const appPolicy = definePolicy<AppState, Role>({
  integrations: [targetAllowlist(erpTarget, (_s, id) => id === 'erp-integration')],
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    [operations.deliveryList.id]: 'open', // handler scopes the rows
    [operations.deliveryReceive.id]: editor, // a rule
    ...targetRules(erpTarget), // integration-only operations
  },
  events: { delivery: () => true },
});
```

Each operation is one of:

- `open`: any caller who passes `caller`; the handler scopes rows.
- `integration`: only an integration allowlist may call it.
- a rule: resolves the record's container from stored state and names the allowed roles. It can also require that a limited grant contain the resource, or refuse delegated runs.

A rule runs on both the current and the proposed state, so it can't skip the commit-time check. Roles come from membership; `set-member` refuses a change to your own role.

Test it:

```sh
bun test packages/runtime/test packages/adapters/src/casl.test.ts
bun test showcase/examples/field-service/test/security-conformance.test.ts
```

## Who the caller is

The host builds the execution context from the session. Capability input can't set the principal, workspace, roles or grant. The local host starts as the local user. A provider account grants no workspace access, and an approval never allows what the policy denies.

## Command checks

In `packages/runtime/src/application/commands.ts`:

1. Validate input and context: workspace, principal, cancellation, grant operations, expiry, bindings.
2. In the transaction, ask the policy on current state. An expected revision counts as a read.
3. Run the handler. The runtime refuses a change to a resource outside the grant.
4. Project and validate the output.
5. Ask the policy again on the before and after state.

The runtime rechecks the context after every awaited step and before commit. Any failure rolls back everything.

A nested call (`ctx.invoke`, `ctx.query`, `continueWith`) runs steps 1–5 for its own operation. The grant must list it and the caller must list it in `invokes`. The policy sees `via`, the enclosing operations. A nested refusal fails the whole command even if the handler catches it.

The policy also projects outputs to the fields the caller may read, and decides journal delivery. In `field-service`, only dispatchers see internal notes; response schemas make those fields optional so projected output still validates.

## Feature policies

A feature such as approvals decides its own operations (`routeAuthorization` in `packages/runtime/src/compose.ts`). It reads an access view the application computes, which applies the app's membership, integration allowlists and grant scope. Person-only rules live there: approving, rejecting and resolving held effects refuse delegated callers. A caller who can't read an approval request gets `NOT_FOUND`. Test: `packages/runtime/test/approval-feature.test.ts`.

## Lists

The handler scopes a list to what you may see before filtering, sorting, paging or counting. You can't filter or sort on protected fields. A delegated grant narrows lists further.

## Delegation and replay

Effective access is your current policy intersected with the grant. A grant can limit operations, resource IDs and lifetime, and bind to a principal, workspace and run. An agent run keeps its starting grant. A resource-scoped grant may change only those records; its `creates` list lets it add records of named types (e.g. `approval-request`).

- **Retry:** the same idempotency key returns the stored receipt after authorizing again, including each nested command (`replay` phase). An old receipt can't recover revoked access.
- **Dispatch:** before the first claim of an outbox effect, the runtime authorizes the committing person again without delegation (`dispatch` phase). A denial puts the effect in `held` for a person.

## Revocation and live updates

Membership changes serialize with business changes and bump the authorization revision. The runtime rechecks grant expiry and run cancellation after every await. A session revoked while its command waits still commits ([known defect](implementation-status.md#known-defects)).

Journal entries contain references and revisions, not contents, and the stream filters delivery inside the storage read. When the authorization revision changes, streams reset without leaking newly forbidden IDs, and live queries drop old data. Nothing can withdraw bytes already sent, so screens hide sensitive drafts after a revocation.

## UI sessions

A UI session context stores navigation and selection, bound to the live credential, principal and workspace. The host checks selections against authorized queries and freezes them when a run captures them. UI intents go only to the captured session, the run reads each named record under its grant, and no intent commits records. A leaked session ID grants nothing.

## Process boundary

The instance owns the workspace under an exclusive OS lock. Other processes attach through its connection file. Nothing sandboxes processes running as the same OS user.

## CASL adapter

The CASL adapter turns row scopes into SQL. It accepts only these over registered scalar fields:

```ts
{ eq: ['workOrderId', 'w1'] }
{ in: ['workOrderId', ['w1', 'w2']] }
{ and: [a, b] } { or: [a, b] } { not: a }
```

It rejects unknown fields, operators, unsafe column names, wildcards and allow-after-deny; values become SQL parameters; denies win. A new operator needs agreement tests across object, memory and SQL (`packages/adapters/src/casl.test.ts`).

## See also

[State and reactivity](state-and-reactivity.md) · [Systems of record](systems-of-record.md#worker-claims) · [Adapters](adapters.md#http) · [Architecture](architecture.md#instances-and-hosts)

---
name: add-capability
description: Implement or change an application command or query with its policy and screen binding. Use for new domain behavior or a stored-shape migration. Also covers trigger jobs and changes to agent tool permissions.
---

# Add a capability

Implement the requested operation in the application's browser-safe contract and server handler. Identify the resources it reads or changes and the caller permissions that apply. The [operations guide](../../../../docs/capability-authoring.md) defines execution semantics.

## Contract and composition

In a scaffolded application, run from the repository root:

```sh
bun run scaffold add capability <dotted.id> --kind command|query --description "<operation and permission>"
```

Keep the scaffold markers. Review generated role references after a role rename. For keyed records, use collection declarations and their generated operations where their behavior fits. `add collection <type> --tree` adds the parent relation and tree read. Computed filters require a query that filters and authorizes before paging or counting; expose `offset` and `limit` and return `{ items, total }` for pageable exports.

Define strict JSON input and output schemas with a stable operation ID and permission. Use a UI exception until a screen implements the binding. Output fields hidden by policy must be optional. Schemas must convert to JSON Schema; perform normalization in the handler and keep schema transforms and refinements out of the contract. Declare display metadata for returned records and describe input properties with `.describe()` so generated tools receive the descriptions.

Collection display fields describe their presentation kind. Reads can use `present` to expose a revision from `ctx.getRevision` without storing it. The collection handlers' `defaults`, `normalize` and `validate` hooks contain the application rules. `collectionList` supports equality filters over stored fields, declared sorting and search. `collectionUpdate` accepts `null` to clear an optional item field.

Register the module and handler through the application's `manifest.ts` and `application.ts`. Domain behavior stays in that workspace. Channels call the registered operation through the runtime; do not add another writable store or transport-specific implementation.

## Handler and policy

Bind handlers with `createHandlerFactory`. Register every changed resource with `ctx.change`. Read time through the application's clock service so tests can supply a fixed clock. Implement operation authorization with the object and field checks needed for the requested input. Filter rows before paging or counting.

Declare nested calls in `invokes`, then await each `ctx.invoke` or `ctx.query` call before starting another. `invokes: 'any'` permits input-selected operations. Catalog validation rejects unknown callees and invocation cycles. A query cannot invoke a command, and a call chain cannot exceed four levels. Nested operations keep the caller context and participate in the transaction. Include their external requirements in the invoking operation and in grants that permit it.

External writes enqueue an outbox effect with `ctx.enqueue` and declare the integration. Network calls cannot run inside the transaction. Use [connect-system-of-record](../../../integration/skills/connect-system-of-record/SKILL.md) when the write needs external acceptance or reconciliation.

For uploaded content, use `blobRefSchema` and declare the capability's blob limits. Upload through the transport before invocation, then attach the reference to its record with `ctx.attach`. Test helpers provide `putBlob`; the runtime checks uploader access and limits at commit.

When stored state changes, add a deterministic `StateMigrations` step. Test loading the old stored shape. Normal handlers use the current shape. The [migration contract](../../../../docs/primitives.md#state-migration) identifies the owning implementation.

## Screens and agents

Use [build-screens](../../../frame/skills/build-screens/SKILL.md) to bind the operation. Preserve the form's idempotency key across retries through `useCapabilityForm`.

Update agent scenarios when the changed operation is available to an agent. `runAgentScenarios` from `@tortoise/testing/agent-scenarios` tests a task against fixture state. Specify expected commits and approval requests, with calls that must be refused. A scripted question uses `question`; expected `answers` and `questions` describe the interaction. Pass `scenarioHarness()` and `scenarioTimeout()` from `@tortoise/testing` to support explicitly configured live execution.

A direct agent lists commands requiring a person's decision in `requests`. Input-dependent approval also needs a policy rule that refuses that input to the agent while allowing the appropriate person. Mount `approvalFeature()` with an `ApprovalAccess` view. [Agents](../../../../docs/agents.md) explains run grants and approval execution.

A scheduled or event-driven job uses an automation trigger under its trigger grant. A durable sequence uses a declared workflow and the [workflow skill](../../../../plugins/workflows/skills/declare-a-workflow/SKILL.md). Follow [serve-a-local-model](../../../../plugins/model-server/skills/serve-a-local-model/SKILL.md) when the agent names a managed local model.

For a new channel or harness, use `operationToolSchema` or `toolEnvelopeSchema` from `@tortoise/contracts`. Recursive input schemas need their `$defs` resolved from the envelope root.

## Checks

Test permitted and refused access. Commands also need stale-revision and repeated-key checks where those controls apply, with their committed changes visible through another channel. Use the behavioral scenarios in `packages/testing` for channel parity. Agent scenarios assert operation outcomes.

```sh
bun run generate
bun run typecheck
bun test showcase/examples/<app>
bunx playwright test showcase/examples/<app>/e2e
```

Inspect the application's security manifest and data flows under `dist/reference/<id>`. Follow [check-a-change](../../../testing/skills/check-a-change/SKILL.md) for the remaining checks and evidence reporting.

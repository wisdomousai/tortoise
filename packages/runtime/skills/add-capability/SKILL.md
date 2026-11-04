---
name: add-capability
description: Add or change a command or query in an agent-native application, with its contract, handler, policy rule, screen binding and behavioral test. Use when a user action, agent tool, CLI subcommand or API call needs new domain behavior, when a stored record shape changes and needs a state migration, or when a trigger should run a job. Covers showcase/examples/<app> and showcase/patterns/<name> contracts.ts, handlers, policy and tests.
---

# Add a capability

A capability is one domain behavior in the catalog. People, agents, the CLI, MCP and HTTP all reach it through the same runtime, so it is written once.

## Before writing

- Name the action or query a person takes, who may run it, on which resource and which fields. That boundary becomes the permission and the policy rule.
- Check [primitives](../../../../docs/primitives.md) for an existing building block: a collection for keyed records, a target for another system's acceptance, a data provider or remote source for a live read.
- If the write must be accepted by another system, read the `connect-system-of-record` skill first (`packages/integration/skills/connect-system-of-record/SKILL.md`).
- Never add a second writable store. Never duplicate a handler in an API route, MCP tool, CLI command or agent adapter; those surfaces are generated from the catalog.

## Steps

1. In an application made by `scaffold new`, start with the scaffold, run from the repository root. It writes the contract, handler, policy rule and a test at the `// scaffold:<list>` markers; keep the markers. Otherwise write the parts by hand as in the steps below.

   ```sh
   bun run scaffold add capability <dotted.id> --kind command|query --description "<what it does, for whom>"
   ```

   `add collection`, `add target`, `add agent` and `add assignment-kind` generate the other parts.
2. For keyed records, declare a collection and generate its operations instead of writing them:
   - reads with `collectionGet`, `collectionList` and, for a collection with a `parent`, `collectionTree`;
   - commands with `collectionCreate`, `collectionUpdate`, `collectionMove` (a `parent`) and `collectionRetire` (a boolean `retiredField`; a record with a status field retires through a command of its own);
   - one handler set from `collectionCommandHandlers`, whose `defaults`, `normalize` and `validate` hooks hold the domain rules, such as a canonical form or a unique name.
   - a `present` option on the read handlers for fields a read returns but the store does not keep, such as `revision: ctx.getRevision('<type>:' + record.id)` for a record a screen shares with agent runs;
   - `filters` (equality on stored fields), `sort` (the fields a caller may order by, as `sortBy` and `sortDirection`) and `search` on `collectionList`; the generic list screen renders them and an agent gets them as tool parameters. `collectionUpdate` takes `null` for a field the item may leave out, which clears it;
   - a hand-written list query for a filter computed when the query runs, such as a due date before today, because `collectionList` filters by equality on stored fields. It filters before paging and counting. Give it `offset` and `limit` and return `{ items, total }`, so the CLI's `--output csv` and the list screen's export can page it.
   - `fields` on the collection with each field's `kind` (`date`, `date-time`, `status` with `tones`, `reference` with the resource kind, `file`), so screens and tool descriptions show the record without hand-written columns; see [capability authoring](../../../../docs/capability-authoring.md#collections).

   `add collection <type> --tree` generates a tree collection. Write a command by hand only when it does more than change one record's fields.
3. Write the contract in the browser-safe module (`contracts.ts`): a stable ID, strict JSON input and output schemas, the permission, and a UI binding or a stated headless exception. For a capability whose output is a record or a list of records, declare `display`: a label, the resource kind, the title field and the shown fields. A schema must convert to JSON Schema, so it holds no `transform`, `refine` or `.trim()`; trim or canonicalize in the handler's `normalize` hook instead.
4. Add workflow text when agents need a sequence of capabilities. It names operation IDs, never transport tool names. A declared workflow (`defineWorkflow` with `step.run` and `step.wait`) adds steps that run over hours or days; the catalog checks its bindings, waits and durations, and the application lists the [workflows plugin](../../../../plugins/workflows/README.md) to run them. A `compensate` command undoes a step when a later one fails for good.
5. Write the handler in the server entrypoint with `createHandlerFactory`. Declare every changed resource with `ctx.change`. To run another operation inside the same transaction, as the same caller:
   - list it in the capability's `invokes`; `'any'` is for a command that runs whatever its input names, such as `approval.approve`;
   - call `ctx.invoke(capability, input, expectedRevisions?)` or `ctx.query(capability, input)` and await each call before the next;
   - the catalog refuses an unknown target, a query that invokes a command, a cycle, and a chain deeper than 4;
   - the operation's destinations, processes and folders, and the grants of agents and job triggers that list it, include what it invokes.
6. For a command that takes a photo or a document as a blob, type the input field with `blobRefSchema` and set the capability's `blobs` limits. The caller uploads the bytes first: a screen with `transport.blobs.put`, a test with `putBlob` on the application. The handler calls `ctx.attach(resource, ref)` on the record that keeps the reference, and at commit the runtime refuses a blob that another principal uploaded or that breaks the limits.
7. Make no network call inside the transaction. Enqueue an outbox effect with `ctx.enqueue` and declare `integration` on the capability instead. The framework's reconciliation capabilities decide the effects the dispatcher holds, without a new command; the `connect-system-of-record` skill covers them.
8. Write the policy for the operation, the object, current and proposed fields, and grant scope. Filter rows before paging or counting.
9. Compose through the application's `manifest.ts` and `application.ts`, never in `apps/*`.
10. Declare what it reaches: network destinations, exchange folders, devices, child processes, and the input fields safe to log in plain text.
11. Bind it to a screen with the `build-screens` skill (`packages/frame/skills/build-screens/SKILL.md`). Keep `useCapabilityForm`, so a retry reuses one idempotency key.
12. Prove it with a behavioral scenario: permitted and denied access and, for a command, a stale revision, a repeated idempotency key and the change visible to another process. A handler reads the time through `services.now` (`now(ctx)` in the generated `handlers/context.ts`), so a test passes a fixed clock in the services. Use `packages/testing` for cross-surface scenarios.
13. When a stored shape changes, add a step to the application's `StateMigrations` instead of reading both shapes in the handler. The `packages/kernel` README and [state migration](../../../../docs/primitives.md#state-migration) describe the steps; `showcase/patterns/operations/migrations.ts` has one.
14. For a scheduled or event-driven job, declare a trigger from `plugins/automation`. It submits commands under its trigger grant like any caller. `showcase/patterns/agents/automation.ts` runs a job that requests approval instead of committing.
15. When an agent definition gains or loses a capability, or a capability an agent uses changes, add or update the agent's scenarios in its scenario test, `showcase/examples/<app>/test/<name>-agent.test.ts` as `scaffold add agent` writes it, with `runAgentScenarios` from `@tortoise/testing/agent-scenarios`. A scenario holds:
    - a task and fixture state;
    - the commits and approval requests expected;
    - the calls that must be refused;
    - for a run that asks the person, the `answers` and the number of `questions` expected; a deterministic `script` asks with `question`.

    Scenarios judge the receipts, never the agent's text. Pass `harness: scenarioHarness()` from `@tortoise/testing` and give the test `scenarioTimeout()`, as the generated test does, so `AGENT_SCENARIOS=live` runs them against a local model.

    A `direct` agent that must ask before some changes lists those commands in `requests`, such as a cancellation, or a command it runs itself whose policy refuses it some input, such as a discount above its limit. Its grant then holds `approval.request` and its instructions list those commands. The policy decides which input needs approval: refuse it to a delegated caller (`context.grant?.agent`) and allow it to the approver.

    An agent that requests approval needs the `approval` feature: mount `approvalFeature()` with an `ApprovalAccess` view, as the `write-a-feature` skill (`packages/host/skills/write-a-feature/SKILL.md`) describes.
16. For an agent that names a local model in `models`, and the approval dataset its decisions become, follow the `serve-a-local-model` skill (`plugins/model-server/skills/serve-a-local-model/SKILL.md`).
17. Write a command's `description` for a model as well as a person. Describe each input property with zod's `.describe()`; a doc comment on a schema field does not reach the JSON Schema a model reads. The generated collection reads and commands describe the `id`, search and paging inputs they add. A run under an agent definition starts its prompt with `agentInstructions(catalog, agentId)`, which lists a requesting agent's commands, or a direct agent's `requests`, and their inputs with those descriptions. A screen starts such a run with `POST /api/v1/runs` and `agentId` ([agents](../../../../docs/agents.md#runs)).
18. For a new surface or harness, build a capability's tool schema with `operationToolSchema` from `@tortoise/contracts`, or `toolEnvelopeSchema` for the surface's own envelope fields. A recursive input schema (`jsonValueSchema`, `z.lazy`) includes `$defs` that resolve only from the envelope's root. llama.cpp and strict MCP clients refuse the tool otherwise.

## Checks

```sh
bun run format && bun run generate
bun run typecheck
bun test showcase/examples/<app>
bunx playwright test showcase/examples/<app>/e2e
```

After `generate`, read the application's security manifest and data flows in `dist/reference/<id>/` for the destinations the change added. Then follow the `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`) for the rest and for how to report what passed.

## References

- [Capability authoring](../../../../docs/capability-authoring.md)
- [`showcase/examples/field-service`](../../../../showcase/examples/field-service/README.md)
- [Authorization](../../../../docs/authorization.md)
- [Patterns](../../../../docs/patterns.md)

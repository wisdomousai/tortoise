---
name: add-capability
description: Add or change a command or query in an agent-native application, with its contract, handler, policy rule, screen binding and behavioral test. Use when a user action, agent tool, CLI subcommand or API call needs new domain behavior, when a stored record shape changes and needs a state migration, or when a trigger should run a job. Covers examples/<app>/contracts.ts, handlers, policy and tests.
---

# Add a capability

A [capability](../../../../docs/glossary.md#capability) is one domain behavior in the [catalog](../../../../docs/glossary.md#catalog). People, agents, the CLI, MCP and HTTP all reach it through the same runtime, so it is written once.

## Before writing

- Name the action or query a person takes, who may run it, on which resource and which fields. That boundary becomes the permission and the [policy](../../../../docs/glossary.md#policy) rule.
- Check [primitives](../../../../docs/primitives.md) for an existing building block: a collection for keyed records, a target for another system's acceptance, a data provider or remote source for a live read.
- If the write must be accepted by another system, read the `connect-system-of-record` skill first (`packages/integration/skills/connect-system-of-record/SKILL.md`).
- Never add a second writable store. Never duplicate a handler in an API route, MCP tool, CLI command or agent adapter; those surfaces are generated from the catalog.

## Steps

1. In an application made by `scaffold new`, start with the scaffold. It writes the contract, handler, policy rule and a test at the `// scaffold:<list>` markers; keep the markers. Otherwise write the parts by hand as in the steps below.

   ```sh
   bun run scaffold add capability <dotted.id> --kind command|query --description "<what it does, for whom>"
   ```

   `add collection`, `add target` and `add agent` generate the other parts.
2. Write the contract in the browser-safe [module](../../../../docs/glossary.md#module) (`contracts.ts`): a stable ID, strict JSON input and output schemas, the permission, and a [UI binding](../../../../docs/glossary.md#ui-binding) or a stated headless exception.
3. Add workflow text when agents need a sequence of capabilities. It names operation IDs, never transport tool names. A declared workflow (`defineWorkflow` with `step.run` and `step.wait`) adds steps that run over hours or days; the catalog checks its bindings, waits and durations.
4. Write the [handler](../../../../docs/glossary.md#handler) in the server entrypoint with `createHandlerFactory`. Declare every changed resource with `ctx.change`. To run another operation inside the same transaction, as the same caller:
   - list it in the capability's `invokes`; `'any'` is for a command that runs whatever its input names, such as `approval.approve`;
   - call `ctx.invoke(capability, input, expectedRevisions?)` or `ctx.query(capability, input)` and await each call before the next;
   - the catalog refuses an unknown target, a query that invokes a command, a cycle, and a chain deeper than 4;
   - the operation's destinations, processes and folders, and the grants of agents and job triggers that list it, include what it invokes.
5. Make no network call inside the transaction. Enqueue an [outbox effect](../../../../docs/glossary.md#effect) with `ctx.enqueue` and declare `integration` on the capability instead. The framework's reconciliation capabilities decide the effects the dispatcher holds, without a new command; the `connect-system-of-record` skill covers them.
6. Write the policy for the operation, the object, current and proposed fields, and grant scope. Filter rows before paging or counting.
7. Compose through the application's `manifest.ts` and `application.ts`, never in `apps/*`.
8. Declare what it reaches: network destinations, exchange folders, devices, child processes, and the input fields safe to log in plain text.
9. Bind it to a [screen](../../../../docs/glossary.md#screen) with the `build-screens` skill (`packages/frame/skills/build-screens/SKILL.md`). Keep `useCapabilityForm`, so a retry reuses one [idempotency key](../../../../docs/glossary.md#idempotency-key).
10. Prove it with a [behavioral scenario](../../../../docs/glossary.md#behavioral-scenario): permitted and denied access, a stale revision, a repeated idempotency key, and the change visible to another process. Use `packages/testing` for cross-surface scenarios.
11. When a stored shape changes, add a step to the application's `StateMigrations` instead of reading both shapes in the handler. The `packages/kernel` README and [state migration](../../../../docs/primitives.md#state-migration) describe the steps.
12. For a scheduled or event-driven job, declare a [trigger](../../../../docs/glossary.md#trigger) from `plugins/automation`. It submits commands under its standing grant like any caller.
13. When an agent definition gains or loses a capability, or a capability an agent uses changes, add or update the agent's scenarios in `examples/<app>/test/agent-scenarios.test.ts` with `runAgentScenarios` from `@agent-native/testing/agent-scenarios`. A scenario holds:
    - a task and fixture state;
    - the commits and approval requests expected;
    - the calls that must be refused.

    Scenarios judge the receipts, never the agent's text.

    An agent that requests approval needs the `approval` feature: mount `approvalFeature()` with an `ApprovalAccess` view, as the `write-a-feature` skill (`packages/host/skills/write-a-feature/SKILL.md`) describes.
14. For an agent that names a local model in `models`, and the [approval dataset](../../../../docs/glossary.md#approval-dataset) its decisions become, follow the `serve-a-local-model` skill (`plugins/model-server/skills/serve-a-local-model/SKILL.md`).
15. Write a command's `description` for a model as well as a person. A run under an agent definition starts its prompt with `agentInstructions(catalog, agentId)`, which lists a requesting agent's commands and their inputs with those descriptions.
16. For a new surface or harness, build a capability's tool schema with `operationToolSchema` from `@agent-native/contracts`, or `toolEnvelopeSchema` for the surface's own envelope fields. A recursive input schema (`jsonValueSchema`, `z.lazy`) carries `$defs` that resolve only from the envelope's root. llama.cpp and strict MCP clients refuse the tool otherwise.

## Checks

```sh
bun run format && bun run generate
bun run typecheck
bun test examples/<app>
bunx playwright test examples/<app>/e2e
```

After `generate`, read the application's security manifest and data flows in `dist/reference/<id>/` for the destinations the change added. Then follow the `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`) for the rest and for how to report what passed.

## References

- [Capability authoring](../../../../docs/capability-authoring.md)
- [`examples/project-tasks`](../../../../examples/project-tasks/README.md)
- [Authorization](../../../../docs/authorization.md)

---
name: add-capability
description: Add or change a command or query in an agent-native application, with its contract, handler, policy rule, screen binding and behavioral test. Use when a user action, agent tool, CLI subcommand or API call needs new domain behavior, when a stored record shape changes and needs a state migration, or when a trigger should run a job. Covers examples/<app>/contracts.ts, handlers, policy and tests.
---

# Add a capability

A capability is one domain behavior in the catalog. People, agents, the CLI, MCP and HTTP all reach it through the same runtime, so it is written once. [Capability authoring](../../../../docs/capability-authoring.md) is the full guide, and `examples/project-tasks` is the smallest worked application.

## Before writing

- Name the user action or query, who may run it, on which resource and which fields. That boundary becomes the permission and the policy rule.
- Check [primitives](../../../../docs/primitives.md) for an existing building block: a collection for keyed records, a target for another system's acceptance, a data provider or remote source for a live read.
- If the write must be accepted by another system, read the `connect-system-of-record` skill first (`packages/integration/skills/connect-system-of-record/SKILL.md`).

## Steps

1. In an application made by `scaffold new`, start with `bun run scaffold add capability <dotted.id> --kind command|query --description "<what it does, for whom>"` (or `add collection`, `add target`, `add agent`). It writes the contract, handler, policy rule and a test at the `// scaffold:<list>` markers; keep the markers. Otherwise write the parts by hand as below.
2. **Contract** in the browser-safe module (`contracts.ts`): stable ID, strict JSON input and output schemas, permission, and a UI binding or a stated headless exception. Add workflow text when agents need a sequence of operations; it names operation IDs, never transport tool names.
3. **Handler** in the server entrypoint with `createHandlerFactory`. Declare every changed resource with `ctx.change`. No network call inside the transaction: enqueue an outbox effect with `ctx.enqueue` and declare `integration` on the capability instead.
4. **Policy** for operation, object, current and proposed fields, and grant scope. Filter rows before paging or counting. See [authorization](../../../../docs/authorization.md).
5. **Compose** through the application's `manifest.ts` and `application.ts`, never in `apps/*`.
6. **Declare what it reaches**: network destinations, exchange folders, devices, child processes, and the input fields safe to log in plain text.
7. **Bind it to a screen** (the `build-screens` skill, `packages/frame/skills/build-screens/SKILL.md`), keeping `useCapabilityForm` so a retry reuses one idempotency key.
8. **Prove it** with a behavioral scenario: permitted and denied access, a stale revision, a repeated idempotency key, and the change visible to another process. Use `packages/testing` for cross-surface scenarios.

When a stored shape changes, add a step to the application's `StateMigrations` (`packages/kernel` README, [state migration](../../../../docs/primitives.md#state-migration)) instead of reading both shapes in the handler. A scheduled or event-driven job is a trigger from `plugins/automation`; it submits commands under its own grant like any caller.

When an agent definition gains or loses an operation, or an operation an agent uses changes, add or update the agent's scenarios (`examples/<app>/test/agent-scenarios.test.ts`, `runAgentScenarios` from `@agent-native/testing/agent-scenarios`): a task and fixture state, the commits and proposals expected, and the calls that must be refused. They judge the receipts, never the agent's text. An agent that names a local model in `models`, and the proposal dataset its decisions become, are covered by the `serve-a-local-model` skill (`plugins/model-server/skills/serve-a-local-model/SKILL.md`).

Never add a second writable store, and never duplicate a handler in an API route, MCP tool, CLI command or agent adapter. Those surfaces are generated from the catalog.

## Checks

```sh
bun run format && bun run generate
bun run typecheck
bun test examples/<app>
bunx playwright test examples/<app>/e2e
```

After `generate`, read the application's security manifest and data flows in `dist/reference/<id>/` for the destinations the change added. Then run the `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`) for the rest and for how to report what passed.

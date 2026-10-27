---
name: declare-a-workflow
description: Declare a durable workflow whose steps run commands and wait on queries over minutes to weeks, as the person who started it, with retries and compensations, and run it with the workflows host plugin. Use when a sequence waits on a reviewer or an outbox outcome between steps, when a later failure must undo earlier steps, or when an application starts, follows or cancels workflow instances. Covers defineWorkflow, step.run, step.wait, the start command, compensations and runner tests.
---

# Declare a workflow

A [workflow](../../../../docs/glossary.md#workflow) is a sequence of steps over existing capabilities. Each [workflow instance](../../../../docs/glossary.md#workflow-instance) advances one step per command, as its starter, and undoes its completed steps with their [compensations](../../../../docs/glossary.md#compensation) when a step fails for good.

## Before writing

- Writes that must commit together are one command with nested calls; work that starts on a change or a schedule is a [trigger](../../../../docs/glossary.md#trigger). [Choosing a composition](../../../../docs/capability-authoring.md#choosing-a-composition) compares the three.
- Every step names a command or query that already exists. Add a missing one with the `add-capability` skill (`packages/runtime/skills/add-capability/SKILL.md`) first.
- A step that ends in another system's acceptance enqueues an outbox effect; the `connect-system-of-record` skill (`packages/integration/skills/connect-system-of-record/SKILL.md`) covers the target.
- Decide what undoes each step that changes something outside the application. A compensation is an ordinary command, such as `filing.withdraw`, and it must be safe to run twice.

## Steps

1. Declare the workflow in the browser-safe module with `defineWorkflow` from `@agent-native/contracts`: a stable `id`, a `version`, `text`, an `input` schema, `maxDurationMs` and `start`, the command that starts it.
2. Write the steps in order:
   - `step.run(id, command, { input, when?, await?, retry?, compensate? })` runs a command; `await: 'effects'` completes it once every effect it enqueued was accepted;
   - `step.wait(id, query, { input, until, watch?, recheckMs?, timeoutMs })` checks a query until its condition holds, after a change to a `watch` resource type or every `recheckMs`;
   - bind inputs with `from.input`, `from.step`, `from.effect` and, in `until`, `from.result`; conditions use `equals`, `in`, `exists`, `all`, `any` and `not`;
   - `retry: { attempts, backoffMs, on }` lists the codes worth retrying beyond `UNAVAILABLE` and `CONFLICT`.
3. List the workflow in the module's `workflows`. The catalog refuses an unknown operation, a binding that reads ahead, an unbound required input, a step that reaches a `workflow.*` operation and durations out of range.
4. Write the start command. It lists `workflow.start` in `invokes` and calls `ctx.invoke(workflowOperations.start, { workflow, input, key })` from `@agent-native/workflows/contracts`. The `key` is the business key, such as a capture ID; one instance per key runs at a time. Its output is `instanceSchema`.
5. Give the start command a policy rule. The steps need none of their own: each passes the application's policy as the starter when it runs.
6. Compose the plugin: `workflowsPluginManifest` in the manifest's plugins, `createWorkflowsPlugin({ intervalMs, now, newId })` in the application's plugins and `workflowsScreens` in the screens.
7. Bind the start command to a screen with the `build-screens` skill (`packages/frame/skills/build-screens/SKILL.md`). The `/workflows` route lists instances, their history, and cancel, retry and resolve.
8. Bump `version` when the steps change. Running instances of the old definition stall with `DEFINITION_CHANGED`, and their starters cancel them.

## Checks

Drive the runner one pass at a time on a test clock, with `passOnce` from `@agent-native/workflows/runner`, as `showcase/examples/asset-survey/test/capture-to-eam.test.ts` does. The kernel checks grant expiry on its own clock, so start the test clock at `Date.now()`. Cover:

- the instance reaching `succeeded`, and the records each step wrote;
- a rejected effect or a permanent failure running the compensations, latest first;
- a wait timing out, and a cancel during a wait;
- a starter without a role a step needs being refused.

```sh
bun test showcase/examples/<app>
bun test plugins/workflows
```

Then follow the `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`).

## References

- [Workflows plugin](../../README.md)
- [Capability authoring](../../../../docs/capability-authoring.md#declared-workflows)
- [`showcase/examples/asset-survey`](../../../../showcase/examples/asset-survey/README.md)

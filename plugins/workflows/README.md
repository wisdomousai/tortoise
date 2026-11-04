# @tortoise/workflows

Runs multi-step workflows declared with `defineWorkflow`. Compose `createWorkflowsPlugin` and list its screens from `@tortoise/workflows/plugin-screens`. `workflow.start` records an instance under a grant narrowed from the caller's (the workflow's operations, what they invoke, and `workflow.advance` and `workflow.fail`, within the caller's resource scope); the runner then advances it one step at a time as the person who started it. That grant expires at the earlier of the caller's grant expiry and a day past the instance's deadline.

Primitives:

- [Workflow](../../docs/primitives.md#workflow)
- [Host plugin](../../docs/primitives.md#host-plugin)
- [Nested call](../../docs/primitives.md#nested-call)

## References

- [declare-a-workflow](skills/declare-a-workflow/SKILL.md)
- [Capability authoring: declared workflows](../../docs/capability-authoring.md#declared-workflows)
- `bun test plugins/workflows`

# @tortoise/workflows

`@tortoise/workflows` advances workflow declarations created with `defineWorkflow`. `createWorkflowsPlugin` supplies the runner and its persisted workflow feature. The application can register the plugin screens to expose workflow state.

`workflow.start` records an instance under a grant narrowed from its caller. The runner invokes each step under that context and the caller's resource scope. The workflow grant expires according to the caller's expiry and the instance deadline; recovery cannot widen it.

## References

[declare-a-workflow](skills/declare-a-workflow/SKILL.md)

[Capability authoring: declared workflows](../../docs/capability-authoring.md#declared-workflows)

`bun test plugins/workflows`

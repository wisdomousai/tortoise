# @tortoise/webhook

`@tortoise/webhook` observes committed operations and delivers configured webhook notifications. Its background loop acts through a delegated grant limited to the observed operations and the plugin's own capabilities.

The application composes the plugin manifest and server contribution, then registers the supplied plugin screens if it exposes their controls. The destination must be declared and bound through the deployment policy.

## References

[write-host-plugin](../../packages/host/skills/write-host-plugin/SKILL.md)

`bun test plugins/webhook`

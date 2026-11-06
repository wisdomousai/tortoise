# @tortoise/notifications

`@tortoise/notifications` delivers declared notification effects through the shell port. Compose `notificationsPlugin` with the OS plugin. The application declares a `notify` action and names the outbox targets it supports.

A notification payload identifies its recipient and contains the replies offered by the platform. Each reply names a continuation command and its input. The plugin validates the reply nonce and invokes that continuation as the notified person. Replies arrive through the untrusted OS request path, so their payload cannot supply execution authority.

## References

[add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md)

`bun test plugins/notifications`

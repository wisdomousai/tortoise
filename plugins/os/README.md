# @tortoise/os

`@tortoise/os` provides the shell port through `createOsPlugin`. It matches incoming OS requests to declared handlers and delivers the resulting request to the submitting session's frame. Outgoing actions use the platform's configured shell adapter.

Request data cannot establish a principal or widen the session's grant. A handler can prepare a screen, while a resulting record change still requires a catalog command under current authorization.

## References

[add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md)

`bun test plugins/os`

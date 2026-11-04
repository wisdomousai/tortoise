# @tortoise/os

Provides the shell port. `createOsPlugin` delivers incoming OS requests to the right screen and runs declared OS actions through the caller's shell adapter. A request never sets the principal, workspace or grant; the plugin attributes it to the session that submitted it and delivers it only to that session's frame.

Primitives:

- [Shell port](../../docs/primitives.md#shell-port)
- [OS handler](../../docs/primitives.md#os-handler)
- [OS action](../../docs/primitives.md#os-action)
- [Host plugin](../../docs/primitives.md#host-plugin)

## References

- [add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md)
- `bun test plugins/os`

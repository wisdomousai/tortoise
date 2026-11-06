# @tortoise/os-shortcuts

`@tortoise/os-shortcuts` registers launcher shortcuts for declared `shortcut` handlers. Compose `openOsShortcuts` with the OS plugin so incoming shortcut links reach the application's frame.

A shortcut can be opened by other software on the device. Its payload is an unsolicited OS request and does not establish authorization to execute a command.

## References

[add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md)

`bun test plugins/os-shortcuts`

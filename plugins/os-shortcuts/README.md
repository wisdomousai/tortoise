# @agent-native/os-shortcuts

Serves the app's `shortcut` OS handlers: launcher entries such as "New task". Compose `openOsShortcuts` beside the OS plugin. Any app or web page can open a shortcut link, as any page can open the launch page, so the plugin treats a shortcut as an unsolicited OS request.

Primitives:

- [OS handler](../../docs/primitives.md#os-handler)
- [Host plugin](../../docs/primitives.md#host-plugin)

## References

- [add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md)
- `bun test plugins/os-shortcuts`

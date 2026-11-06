# @tortoise/kernel

`@tortoise/kernel` composes an application and opens its instance on a `HostPlatform`. `defineApplication` binds the server contributions to the browser-safe manifest. `openInstance` validates the platform requirements before opening plugins and storage.

The kernel supplies default ports and defines the plugin lifecycle. Platform-specific implementations are injected by the host. The package uses no Bun or Node APIs, allowing the mobile host to use the same composition model. Browser code imports the manifest entrypoints without loading server composition.

## References

[write-a-feature](../host/skills/write-a-feature/SKILL.md), [write-host-plugin](../host/skills/write-host-plugin/SKILL.md)

[Architecture](../../docs/architecture.md#instances-and-hosts)

Test: `bun test packages/kernel`, `bun run test:portable`

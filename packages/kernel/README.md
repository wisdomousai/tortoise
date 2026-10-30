# @agent-native/kernel

The portable core of the host: composes an application and its plugins and opens its instance on a `HostPlatform`. It uses no Node, Bun or React Native API, so the desktop and mobile hosts share it. The starter chooses the platform; content never supplies one.

- Primitives: [Application](../../docs/primitives.md#application), [Host](../../docs/primitives.md#host), [Feature](../../docs/primitives.md#feature), [Host plugin](../../docs/primitives.md#host-plugin), [Shell port](../../docs/primitives.md#shell-port), [Process port](../../docs/primitives.md#process-port), [State migration](../../docs/primitives.md#state-migration), [Blob store](../../docs/primitives.md#blob-store), [Shelf life](../../docs/primitives.md#shelf-life), [Host platform](../../docs/primitives.md#host-platform).

## References

- [write-a-feature](../host/skills/write-a-feature/SKILL.md), [write-host-plugin](../host/skills/write-host-plugin/SKILL.md)
- [Architecture](../../docs/architecture.md#instances-and-hosts)
- Test: `bun test packages/kernel`, `bun run test:portable`

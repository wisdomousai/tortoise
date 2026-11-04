# @tortoise/webhook

An example third-party plugin. It posts a notification to one declared webhook whenever an observed command commits; `field-service` composes it, with screens from `@tortoise/webhook/plugin-screens`. The loop is a caller like an agent run: it acts as the local owner, narrowed by a delegated grant to the observed capabilities and the plugin's own two.

Primitives:

- [Host plugin](../../docs/primitives.md#host-plugin)
- [Module](../../docs/primitives.md#module)
- [Capability](../../docs/primitives.md#capability)
- [Requirement declaration](../../docs/primitives.md#requirement-declaration)
- [Deployment policy](../../docs/primitives.md#deployment-policy)
- [Policy](../../docs/primitives.md#policy)

## References

- [write-host-plugin](../../packages/host/skills/write-host-plugin/SKILL.md)
- `bun test plugins/webhook`

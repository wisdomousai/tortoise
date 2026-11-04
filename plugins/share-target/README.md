# @tortoise/share-target

Receives text, links or files shared from other apps (`share` handlers) and opens the system share sheet (`share` actions). Compose `createShareTargetPlugin` beside the OS plugin. The share target's POST is a top-level navigation from whichever app or page shared, with no session the host could trust, so the route runs before the host's origin and session checks and a held share only prefills a form.

Primitives:

- [OS handler](../../docs/primitives.md#os-handler)
- [OS action](../../docs/primitives.md#os-action)
- [Host plugin](../../docs/primitives.md#host-plugin)

## References

- [add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md)
- `bun test plugins/share-target`

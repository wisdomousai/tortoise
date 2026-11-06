# @tortoise/share-target

`@tortoise/share-target` receives data shared to declared OS handlers and supplies outgoing share actions. Compose `createShareTargetPlugin` with the OS plugin.

An incoming share POST can originate from another application without an authenticated host session. The route accepts a held share before the ordinary origin and session checks, then makes it available for form preparation. It does not use the share payload to authorize a record change.

## References

[add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md)

`bun test plugins/share-target`

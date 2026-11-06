# @tortoise/desktop

`@tortoise/desktop` hosts the configured application in Electron. It can attach to an existing instance or start the service process for its window. Closing a window stops the service process that window owns.

The renderer uses context isolation and disabled Node integration. It refuses webviews and renderer permission requests. From the repository root, `bun run dev` opens the desktop host. Packaging is described in the [desktop guide](../../docs/desktop.md).

## References

[add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md), [deploy-an-application](../../plugins/deployment/skills/deploy-an-application/SKILL.md)

[Desktop](../../docs/desktop.md)

Test: `bun run test:package`

# @tortoise/desktop

The Electron window for the application named in `app.config.json`. It attaches to a running instance, or starts `apps/service` and stops it when the window closes. The renderer runs sandboxed with context isolation, no Node integration and web security on; it denies every permission request and refuses webviews. `bun run dev` opens it; `bun run package:desktop <target>` packages it.

- Primitives: [Starter](../../docs/primitives.md#starter), [Shell port](../../docs/primitives.md#shell-port), [OS handler](../../docs/primitives.md#os-handler), [blob store](../../docs/primitives.md#blob-store), [OS action](../../docs/primitives.md#os-action).

## References

- [add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md), [deploy-an-application](../../plugins/deployment/skills/deploy-an-application/SKILL.md)
- [Desktop](../../docs/desktop.md)
- Test: `bun run test:package`

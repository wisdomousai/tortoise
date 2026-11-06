# @tortoise/mobile-shell

`@tortoise/mobile-shell` is the Expo host project. It selects `targets.mobile.application` from `app.config.json`, falling back to the main application selection. The selected manifest must support the mobile target.

The host can open a local workspace or attach to a paired hub. Code executed by Hermes cannot import Bun or Node modules. `bun run mobile:prebuild` regenerates the native projects, and `bun run dev:mobile` starts the configured development client.

## References

[extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md)

[Mobile](../../docs/mobile.md)

Test: `bun test apps/mobile`, `bun run check:mobile-bundle`

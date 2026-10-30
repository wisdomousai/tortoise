# @agent-native/mobile-shell

The Expo project for Android and iOS. It runs the application offline with its own workspace, or shows a paired hub's screens. The application is `targets.mobile.application` in `app.config.json`, else `application`; its manifest must list `mobile` in its targets. Code here runs on Hermes and imports no `node:*`, `bun:*` or host-only module. `bun run mobile:prebuild` generates `ios/` and `android/`; `bun run dev:mobile` starts the Expo dev client.

- Primitives: [Starter](../../docs/primitives.md#starter), [Native frame](../../docs/primitives.md#native-frame), [Host platform](../../docs/primitives.md#host-platform).

## References

- [extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md)
- [Mobile](../../docs/mobile.md)
- Test: `bun test apps/mobile`, `bun run check:mobile-bundle`

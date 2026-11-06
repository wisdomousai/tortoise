# @tortoise/frame-native

`@tortoise/frame-native` supplies navigation and client bindings for native React Native screens. The generated mobile entry passes in the application's screen contribution. The frame obtains its session and live data through the mobile host.

Import native screens through the package's explicit entrypoints. Native components are distributed as a shadcn registry and become application-owned copies when installed. Platform support and the current evidence for device execution are documented in [Mobile](../../docs/mobile.md).

## References

[extend-mobile-host](../mobile/skills/extend-mobile-host/SKILL.md)

[Mobile](../../docs/mobile.md)

Test: `bun test packages/frame-native`, `bun run check:mobile-bundle`

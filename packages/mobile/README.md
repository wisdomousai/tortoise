# @tortoise/mobile

The host platform for Android and iOS. It runs the same kernel and runtime as desktop, one workspace per application in the device's SQLite. It declares no capabilities: a deployment that needs raw sockets, an inbound listener or a child process refuses to start here and names what needs it.

## Writing a native plugin

A plugin that needs Android or iOS code is an ordinary host plugin with an Expo module next to `src/`: `expo-module.config.json` plus `android/` (Kotlin, `expo.modules.kotlin.modules.Module`) or `ios/` (Swift, `ExpoModulesCore.Module`, with a podspec), and an optional `app.plugin.js` config plugin. Set `platforms` and `native: { module, expoPlugin? }` in `plugin-manifest`, get the module with `pluginNativeModule(manifest)` in `open`, and keep files that import Expo or React Native under `src/expo/`. Rebuild with `bun run mobile:prepare && bun run mobile:prebuild`; TypeScript does not check Kotlin or Swift.

- Primitives: [Host platform](../../docs/primitives.md#host-platform), [Instance](../../docs/primitives.md#instance), [Shell port](../../docs/primitives.md#shell-port), [Host plugin](../../docs/primitives.md#host-plugin).

## References

- [extend-mobile-host](skills/extend-mobile-host/SKILL.md)
- [Mobile](../../docs/mobile.md)
- Test: `bun test packages/mobile`, `bun run test:portable`

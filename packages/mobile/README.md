# @tortoise/mobile

`@tortoise/mobile` implements the host platform used by the Expo application on Android and iOS. It opens a local SQLite snapshot workspace through the shared kernel. The platform refuses an application whose requirements need unsupported host facilities, including child processes or an inbound listener.

Native integrations load through declared Expo modules. Platform-specific imports remain under `src/expo/` so portable host code can be tested independently.

## Writing a native plugin

A plugin that needs Android or iOS code is an ordinary host plugin with an Expo module next to `src/`: `expo-module.config.json` plus `android/` (Kotlin, `expo.modules.kotlin.modules.Module`) or `ios/` (Swift, `ExpoModulesCore.Module`, with a podspec), and an optional `app.plugin.js` config plugin. Set `platforms` and `native: { module, expoPlugin? }` in `plugin-manifest`, get the module with `pluginNativeModule(manifest)` in `open`, and keep files that import Expo or React Native under `src/expo/`. Rebuild with `bun run mobile:prepare && bun run mobile:prebuild`; TypeScript does not check Kotlin or Swift.

## References

[extend-mobile-host](skills/extend-mobile-host/SKILL.md)

[Mobile](../../docs/mobile.md)

Test: `bun test packages/mobile`, `bun run test:portable`

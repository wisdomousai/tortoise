# @agent-native/managed-config

The managed configuration host plugin. A fleet administrator configures apps through device management: Android app restrictions, set by the MDM's device policy controller, and iOS managed app configuration, pushed by the MDM. This plugin reads those values when the authority opens and supplies them as other plugins' settings, so a hub address, an enrollment code or a site policy reaches the plugins that declare them without the person typing anything.

Layer: plugins (`plugins/*`). Android and iOS.

## Primitives

- [Host plugin](../../docs/primitives.md#host-plugin): `managedConfigPlugin`, `createManagedConfigPlugin`, `managedConfigPluginManifest`, `managedSettings`, `ManagedValues`. The plugin is a settings provider (`provideSettings`); it adds no operations, declares no settings of its own, and names the native module `AgentNativeManagedConfig` and its config plugin in its manifest. The keys an administrator may set are exactly the settings the composed plugins declare, the same set launcher settings are checked against.

## Entrypoints

| Import                                         | Runs in               | Contents                                                                                                            |
| ---------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/managed-config/plugin-manifest` | browser and any host  | `managedConfigPluginManifest`: platforms `android` and `ios`, the native module and the config plugin.              |
| `@agent-native/managed-config/managed-config`  | any host              | `managedSettings` and `createManagedConfigPlugin(read)` over an injected reader, so Bun tests run it.               |
| `@agent-native/managed-config/plugin`          | React Native (Hermes) | `managedConfigPlugin`, for `defineApplication({ plugins })`, reading through the native module.                     |
| `@agent-native/managed-config/app.plugin`      | Node, at prebuild     | The Expo config plugin; `expo prebuild` runs it with the options `mobile:prepare` writes. Also exported with `.js`. |
| `@agent-native/managed-config/app.plugin.js`   | Node, at prebuild     | The same file, for tools that resolve the path with its extension.                                                  |

The native part is an Expo module (`expo-module.config.json`): `android/` with `ManagedConfigModule.kt`, which reads `RestrictionsManager.applicationRestrictions`, and `ios/` with `ManagedConfigModule.swift` and its podspec, which read the `com.apple.configuration.managed` dictionary from the standard user defaults. Both return strings, turn booleans and numbers into text and return null for any other type. TypeScript does not check the Kotlin or Swift, and `bun run check` compiles neither.

Android only offers keys the app declares at build time. `bun run mobile:prepare` lists every setting the composed plugins declare in `apps/mobile/generated/native.json`, and the config plugin writes them to `res/xml/app_restrictions.xml` as string restrictions and adds the `android.content.APP_RESTRICTIONS` meta-data to the manifest. An MDM console then shows them with their descriptions. iOS needs no declaration.

Setting values for a test, on demand:

- Android emulator: install Google's Test DPC as device or profile owner, open Manage app restrictions, pick the app and set the keys. Test DPC is driven through its UI.
- iOS simulator: `xcrun simctl spawn booted defaults write <bundle id> com.apple.configuration.managed -dict hub-url https://hub.site.example`, then restart the app.

## Trust boundary

Managed values come from the device's management, which the administrator controls, and are trusted like launcher settings. They win over launcher settings, so a person cannot point a managed device at another hub, unless the authority is opened with `launcherSettingsWin`, which is meant for development builds. The mobile starter passes no launcher settings, so on a device managed values are the only supplied settings. An app cannot change its own restrictions.

A key that no composed plugin declares, or a value that is not text, refuses startup and names the key: a pushed value that nothing reads would look enforced while being ignored. Values are read once, when the authority opens; a change pushed later applies on the next start.

A build without the native module refuses startup in `provideSettings`, before any plugin opens, with the instruction to run `bun run mobile:prebuild`.

## Dependencies

Framework: `@agent-native/kernel` (`plugin`, `plugin-manifest`, `manifest` types), `@agent-native/mobile/expo` (`pluginNativeModule`). External: `expo-modules-core` through the mobile package; `expo/config-plugins` in `app.plugin.js`. `check:boundaries` treats `src/` as portable because the manifest lists mobile platforms.

## Tests

```sh
bun test plugins/managed-config
```

`test/managed-config.test.ts` opens an application that composes this plugin and a plugin declaring `hub-url` on the mobile platform with Bun's SQLite and files. Managed values reach the other plugin and win over the launcher's value, except with `launcherSettingsWin`; an undeclared key and a value that is not text refuse startup. It also checks the restrictions XML the config plugin writes, including escaping. The prebuild output (the XML file and the manifest meta-data) and autolinking of both modules were checked once with `expo prebuild --platform android`; the native modules have not been compiled or run.

## Skills

- [extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md): native plugins, native screens and pairing.

# @agent-native/managed-config

The managed configuration [host plugin](../../docs/glossary.md#host-plugin) supplies settings that an administrator sets through device management. On Android these are application restrictions, set by the MDM's device policy controller. On iOS they are managed app configuration, pushed by the MDM. The plugin reads the values when the [instance](../../docs/glossary.md#instance) opens and supplies them as other plugins' settings. A hub address, an enrollment code or a [deployment policy](../../docs/glossary.md#deployment-policy) therefore reaches the plugins that declare them without the person typing anything.

## Layer

Plugins (`plugins/*`). Android and iOS.

## Primitives

- [Host plugin](../../docs/primitives.md#host-plugin): `managedConfigPlugin`, `createManagedConfigPlugin`, `managedConfigPluginManifest`, `managedSettings` and `ManagedValues`.

The plugin is a settings provider (`provideSettings`). It adds no [capabilities](../../docs/glossary.md#capability) and declares no settings of its own. Its manifest names the native module `AgentNativeManagedConfig` and its config plugin. The keys an administrator may set are exactly the settings the composed plugins declare, the same set that launcher settings are checked against.

## Entrypoints

| Import                                         | Runs in               | Contents                                                                                                            |
| ---------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/managed-config/plugin-manifest` | browser and any host  | `managedConfigPluginManifest`: platforms `android` and `ios`, the native module and the config plugin.              |
| `@agent-native/managed-config/managed-config`  | any host              | `managedSettings` and `createManagedConfigPlugin(read)` over an injected reader, so Bun tests run it.               |
| `@agent-native/managed-config/plugin`          | React Native (Hermes) | `managedConfigPlugin`, for `defineApplication({ plugins })`, reading through the native module.                     |
| `@agent-native/managed-config/app.plugin`      | Node, at prebuild     | The Expo config plugin; `expo prebuild` runs it with the options `mobile:prepare` writes. Also exported with `.js`. |
| `@agent-native/managed-config/app.plugin.js`   | Node, at prebuild     | The same file, for tools that resolve the path with its extension.                                                  |

### Native module

The native part is an Expo module (`expo-module.config.json`):

- `android/` holds `ManagedConfigModule.kt`, which reads `RestrictionsManager.applicationRestrictions`;
- `ios/` holds `ManagedConfigModule.swift` and its podspec, which read the `com.apple.configuration.managed` dictionary from the standard user defaults.

Both return strings. They turn booleans and numbers into text and return null for any other type. TypeScript does not check the Kotlin or Swift, and `bun run check` compiles neither.

### Android restriction keys

Android only offers keys the application declares at build time. `bun run mobile:prepare` lists every setting the composed plugins declare in `apps/mobile/generated/native.json`. The config plugin writes them to `res/xml/app_restrictions.xml` as string restrictions, and adds the `android.content.APP_RESTRICTIONS` meta-data to the Android manifest. An MDM console then shows them with their descriptions. iOS needs no declaration.

### Test values

To set values for a test on demand:

- **Android emulator**: install Google's Test DPC as device or profile owner, open Manage app restrictions, pick the application and set the keys. Test DPC is driven through its UI.
- **iOS simulator**: run `xcrun simctl spawn booted defaults write <bundle id> com.apple.configuration.managed -dict hub-url https://hub.site.example`, then restart the application.

## Trust boundary

Managed values come from the device's management, which the administrator controls. They are trusted like launcher settings, and they win over launcher settings, so a person cannot point a managed device at another hub. The exception is an instance opened with `launcherSettingsWin`, which is meant for development builds. The mobile starter passes no launcher settings, so on a device managed values are the only supplied settings. An application cannot change its own restrictions.

A key that no composed plugin declares refuses startup and names the key. So does a value that is not text.

Values are read once, when the instance opens. A change pushed later applies on the next start. A build without the native module refuses startup in `provideSettings`, before any plugin opens, with the instruction to run `bun run mobile:prebuild`.

## Dependencies

- Framework: `@agent-native/kernel` for `plugin`, `plugin-manifest` and the `manifest` types, and `@agent-native/mobile/expo` for `pluginNativeModule`.
- External: `expo` as a peer, `expo-modules-core` through the mobile package, and `expo/config-plugins` in `app.plugin.js`.

`check:boundaries` treats `src/` as portable, because the manifest lists mobile platforms.

## Tests

```sh
bun test plugins/managed-config
```

`test/managed-config.test.ts` opens an application on the mobile platform with Bun's SQLite and files. The application composes this plugin and a plugin that declares `hub-url`. The test covers:

- managed values that reach the other plugin and win over the launcher's value, except with `launcherSettingsWin`;
- an undeclared key and a value that is not text, which refuse startup;
- the restrictions XML the config plugin writes, including escaping.

The prebuild output and autolinking of both modules were checked once with `expo prebuild --platform android`. That output is the XML file and the manifest meta-data. The native modules have not been compiled or run.

## Skills

- [extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md): native plugins, native screens and pairing.

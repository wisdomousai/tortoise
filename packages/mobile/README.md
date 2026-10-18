# @agent-native/mobile

The [host platform](../../docs/glossary.md#host-platform) for Android and iOS. It runs the same kernel and runtime as the desktop host inside the mobile starter, with one [workspace](../../docs/glossary.md#workspace) per application. The starter owns the workspace while its [instance](../../docs/glossary.md#instance) is open, and stores it in the device's SQLite through the snapshot [storage](../../docs/glossary.md#storage) adapter, with blobs in its documents directory. The screens call the instance in-process through the direct transport. There is no listener, no session and no child process.

## Layer

Framework (`packages/*`). The mobile starter in `apps/mobile` uses it, and content never imports it. The package trusts the device's app sandbox and the OS keystore.

## Primitives

- [Host platform](../../docs/primitives.md#host-platform): `createMobilePlatform`, `MobileBindings`, and on Expo `expoPlatform`, `expoSqlDriver`, `expoBlobStore` and `expoSecretStore`.
- [Instance](../../docs/primitives.md#instance): `openMobileInstance`, `MobileInstance`, `MobileInstanceOptions`, and on Expo `followAppState` and `defineBackgroundDelivery`.
- [Shell port](../../docs/primitives.md#shell-port): `connectMobileShell`, `MobileOsBindings`, `MobileOsConnection`, and on Expo `expoOsBindings`.
- [Host plugin](../../docs/primitives.md#host-plugin): `requirePluginNativeModule`, `NativeModuleLookup`, and on Expo `pluginNativeModule`, for plugins that ship native code.

## Entrypoints

| Import                                | Runs in               | Contents                                                                                                                       |
| ------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `@agent-native/mobile`                | any host              | `createMobilePlatform` over injected bindings and `openMobileInstance`. No Expo or React Native import, so Bun tests run it.  |
| `@agent-native/mobile/expo`           | React Native (Hermes) | The Expo bindings. Importing it installs the Web globals Hermes lacks, with `expo-crypto` as the random source. Import it first. |
| `@agent-native/mobile/intent-filters` | build time            | `intent-filters.plugin.cjs`, the Expo config plugin that registers Android intent handlers.                                    |
| `@agent-native/mobile/shortcuts`      | build time            | `shortcuts.plugin.cjs`, the Expo config plugin that writes static Android app shortcuts.                                       |

`src/expo/` holds the parts that import Expo:

- the SQLite driver on `expo-sqlite`'s synchronous API, with a new connection per driver;
- the blob store on `expo-file-system`;
- the starter's lifecycle, through `AppState` and `expo-background-task`;
- the OS bindings: links from React Native's `Linking`, files through `expo-file-system`'s `File`, shares through `expo-sharing` and notifications through `expo-notifications`;
- on Android, intents through the native module `AgentNativeOsIntents` (`expoIntentBindings`).

The [Android intents plugin](../../plugins/android-intents/README.md) brings that native module; without it the intent bindings are absent. The root TypeScript project excludes `src/expo/`, and `tsconfig.native.json` checks it.

A workspace on a device is a name (`field`), not a path, so a configured value cannot address files outside the app's sandbox. Its databases are `<name>.workspace.sqlite` and `<name>.lock.sqlite` in Expo's database directory. Its blobs are in `agent-native/<name>/blobs` under the document directory.

### Writing a native plugin

A [host plugin](../../docs/glossary.md#host-plugin) that needs Android or iOS code is still an ordinary plugin with the three entrypoints. The native parts sit next to `src/`.

The Expo module is `expo-module.config.json` with `android/`, `ios/` or both. Android code is Kotlin (`expo.modules.kotlin.modules.Module`). iOS code is Swift (`ExpoModulesCore.Module`) with a podspec. The module's `Name` is the module name the manifest gives. Expo autolinking finds it through the root `node_modules`, because the root `package.json` links every package of this repository.

An optional Expo config plugin, `app.plugin.js` exported by the package, adds what must exist at build time, such as manifest entries, resources and entitlements. `expo prebuild` runs it with `{ application: { id, title }, settings: [{ key, description }] }`: the application and every setting its composed plugins declare.

In `plugin-manifest`, `platforms` lists `android`, `ios` or both, and `native: { module, expoPlugin? }` names the module and the config plugin. `definePluginManifest` refuses `native` without a mobile platform. `check:boundaries` then treats the plugin's `src/` as portable.

In the plugin's `open` or `provideSettings`, `pluginNativeModule(manifest)` returns the module, or refuses startup in a build that lacks it. Keep the logic in a module that takes the native module as a parameter, as `createIntentSource` and `createManagedConfigPlugin` do. Bun tests then run it with a fake.

Keep files that import `expo-modules-core` or React Native under `src/expo/`, which the root TypeScript project excludes and `tsconfig.native.json` checks. Add the plugin's `src` to `tsconfig.native.json`.

`bun run mobile:prepare` writes `apps/mobile/generated/native.json` with each composed plugin's config plugin and those options. `apps/mobile/app.config.ts` adds them to the Expo configuration. After adding or removing a native plugin, run this and rebuild the starter:

```sh
bun run mobile:prebuild
```

TypeScript checks none of the Kotlin or Swift; that code compiles only in a native build. `plugins/intent-scanner` is the reference for Android with a runtime receiver and no config plugin. `plugins/managed-config` is the reference for Android and iOS with a config plugin.

## Trust boundary

### Platform capabilities

The platform declares no capabilities. A deployment that needs raw sockets, an inbound listener or a child process refuses to start here, naming what needs it. HTTPS clients still go through the network port that plugins provide.

### Ownership and identity

Ownership is an `EXCLUSIVE` transaction on the lock database, held while the instance is open. A second open in the same runtime is refused before SQLite is asked. This covers a background task started while the screens hold the workspace. `defineBackgroundDelivery` therefore takes a function that returns the open instance instead of opening its own.

The screens act as the local [owner](../../docs/glossary.md#owner), the person holding the device. The OS app sandbox is the only isolation from other apps on the device, and anyone who can unlock the device can use the starter. Pairing and device credentials belong to a plugin. This package supplies the secret store they are kept in.

`expoSecretStore` uses `expo-secure-store`: Keychain on iOS and Keystore-encrypted storage on Android. It stores values with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. A background task can therefore read a value after the first unlock, and the value is not restored onto another device.

### Shares and notifications

Shares arrive through `expo-sharing`, which is experimental. It opens the starter with `<scheme>://expo-sharing`, and `expoOsBindings` takes the raw shared items once and clears them. It does not resolve them, because resolving a shared web page fetches it. A share action opens React Native's share sheet. On Android the URL travels in the message, which has no URL field there.

Notifications are local, through `expo-notifications`; there is no push service. The notify binding:

- asks for permission on first use;
- registers one category per set of buttons, because the OS takes button titles from the category;
- shows the notification under its ID, so showing it again replaces it.

Every button brings the starter to the foreground, since its instance submits the reply. A button that requires unlock asks for it first. The `replies` binding reports the choice that launched the starter (`getLastNotificationResponse`) and each later one, but not a plain tap. `expoOsBindings` sets the process's notification handler. Notifications therefore also show while the starter is in the foreground.

### Intent filters and shortcuts

`intent-filters.plugin.cjs` writes one intent filter per intent handler on the main activity. Each filter has the action and categories as declared, plus `DEFAULT`, and replaces the ones an earlier prebuild wrote. `nativeOsConfig` lists the config plugin when an intent handler is declared.

`shortcuts.plugin.cjs` writes static Android app shortcuts for the shortcut handlers:

- `res/xml/os_shortcuts.xml`;
- the shortcut titles as literal string resources;
- the main activity's `android.app.shortcuts` entry.

Each shortcut is a VIEW intent to `<package>.MainActivity` with the shortcut link, so `Linking` reports it like any link. `connectMobileShell` asks the `intents` binding to pass on only the declared actions and extras. It reports an Android build that declares intent handlers without the native module.

### Shell port

`connectMobileShell` attaches the mobile shell adapter to the [shell port](../../docs/glossary.md#shell-port) in-process, as the device's owner. The OS runs in the same process as the instance, so there is no shell route on the device. A link or file the OS opens the starter with is submitted to the port. What the port delivers is held until the frame subscribes, at most 16 deliveries with the oldest dropped.

An opened resource is checked readable by the owner with its kind's read query before it is shown. A blob file is staged in the instance's blob store as the owner, and staged blobs do not survive a restart. Without a plugin that provides the shell port, nothing is attached, read or submitted.

### Foreground and background

Integration loops, plugin observers and the application's `connections.observe` run only in the foreground (`followAppState`). Plugin observers are `PluginInstance.start`, such as the notifications plugin's dispatcher. Each foreground starts the observers again, and each background and `close` stops them. `start` on a phone therefore runs once per foreground instead of once per process.

A background pass is one bounded `drain` and `sync`. The OS decides when the pass runs and may stop it. iOS runs it rarely, so delivery there is in effect a foreground job.

## Dependencies

Framework: `@agent-native/kernel`, `@agent-native/runtime`, `@agent-native/contracts` and `@agent-native/shell` for OS integration. From `@agent-native/adapters` it uses only the portable `sql-driver`, `snapshot-storage`, `exclusive-lock` and `direct-transport` modules.

Expo entry, as peer dependencies: `expo`, `expo-sqlite`, `expo-file-system`, `expo-sharing`, `expo-notifications`, `expo-secure-store`, `expo-crypto`, `expo-background-task`, `expo-task-manager`, `expo-modules-core`, `react-native`.

`check:boundaries` treats `src/` as portable: no Node or Bun import or global.

## Tests

```sh
bun test packages/mobile
bun run test:portable
```

- `test/mobile.test.ts` opens the platform with Bun's SQLite and file blob store in place of Expo's.
  - a capture with a photo committed, closed and found again after reopen;
  - a second open refused while the first holds the workspace;
  - a deployment with an ingress destination refused on iOS;
  - a workspace name that tries to leave the sandbox;
  - the foreground, background and background-pass calls;
  - plugin and application observers started on each foreground and stopped on background and close, but not by a background pass.
- `test/native-module.test.ts`: a plugin's native module found by its manifest name, and the refusal when the build lacks it.
- `test/shortcuts-plugin.test.ts`: the shortcut XML and its escaping, literal string resources and the activity entry written once.
- `test/intent-filters.test.ts`: the intent filter config plugin writes the declared names with `DEFAULT` and replaces its earlier filters.

`test:portable` runs the same suite with the Hermes gaps removed. The Expo bindings are exercised only on a device or emulator.

## Skills

- [extend-mobile-host](skills/extend-mobile-host/SKILL.md): targeting Android and iOS, writing native plugins and screens, and pairing devices with a hub.

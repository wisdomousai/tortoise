# @agent-native/mobile

The host platform for Android and iOS. It runs the same kernel and runtime as the desktop host inside the app: one workspace per application, owned by the app while its authority is open, stored in the device's SQLite with blobs in the app's documents. The screens call the authority in-process through the direct transport. There is no listener, no session and no child process.

Layer: framework (`packages/*`). The mobile starter in `apps/mobile` uses it; content never imports it.

## Primitives

- [Host platform](../../docs/primitives.md#host-platform): `createMobilePlatform`, `MobileBindings`, and on Expo `expoPlatform`, `expoSqlDriver`, `expoBlobStore` and `expoSecretStore`.
- [Authority](../../docs/primitives.md#authority): `openMobileAuthority`, `MobileAuthority`, `MobileAuthorityOptions`; on Expo `followAppState` and `defineBackgroundDelivery`.
- [Shell port](../../docs/primitives.md#shell-port): `connectMobileShell`, `MobileOsBindings`, `MobileOsConnection`, and on Expo `expoOsBindings`.
- [Host plugin](../../docs/primitives.md#host-plugin): `requirePluginNativeModule`, `NativeModuleLookup`, and on Expo `pluginNativeModule`, for plugins that ship native code.

## Entrypoints

| Import                      | Runs in               | Contents                                                                                                                            |
| --------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/mobile`      | any host              | `createMobilePlatform` over injected bindings and `openMobileAuthority`. No Expo or React Native import, so Bun tests run it.       |
| `@agent-native/mobile/expo` | React Native (Hermes) | The Expo bindings. Importing it installs the Web globals Hermes lacks, with `expo-crypto` as the random source, so import it first. |

`src/expo/` holds the parts that import Expo: the SQLite driver on `expo-sqlite`'s synchronous API with a new connection per driver, the blob store on `expo-file-system`, the app lifecycle (`AppState` and `expo-background-task`), and the OS bindings: links from React Native's `Linking` and files read through `expo-file-system`'s `File`. The root TypeScript project excludes that folder; `tsconfig.native.json` checks it.

A workspace on a device is a name (`field`), not a path, so a configured value cannot address files outside the app's sandbox. Its databases are `<name>.workspace.sqlite` and `<name>.lock.sqlite` in Expo's database directory, and its blobs are in `agent-native/<name>/blobs` under the document directory.

### Writing a native plugin

A host plugin that needs Android or iOS code is still an ordinary plugin with the three entrypoints. The native parts sit next to `src/`:

- An Expo module: `expo-module.config.json`, with `android/` (Kotlin, `expo.modules.kotlin.modules.Module`) and/or `ios/` (Swift, `ExpoModulesCore.Module`, plus a podspec). Its `Name` is the module name the manifest gives. Expo autolinking finds it through the root `node_modules`, because the root `package.json` links every workspace package.
- Optionally an Expo config plugin, `app.plugin.js`, exported by the package, for what must exist at build time: manifest entries, resources, entitlements. `expo prebuild` runs it with `{ application: { id, title }, settings: [{ key, description }] }`, the application and every setting its composed plugins declare.
- In `plugin-manifest`: `platforms` lists `android` and/or `ios`, and `native: { module, expoPlugin? }` names both. `definePluginManifest` refuses `native` without a mobile platform, and `check:boundaries` then treats the plugin's `src/` as portable.
- In the plugin's `open` (or `provideSettings`), `pluginNativeModule(manifest)` returns the module or refuses startup in a build that lacks it. Keep the logic in a module that takes the native module as a parameter, as `createIntentSource` and `createManagedConfigPlugin` do, so Bun tests run it with a fake.
- Keep files that import `expo-modules-core` or React Native under `src/expo/`, which the root TypeScript project excludes and `tsconfig.native.json` checks; add the plugin's `src` to `tsconfig.native.json`.

`bun run mobile:prepare` writes `apps/mobile/generated/native.json` with each composed plugin's config plugin and those options, and `apps/mobile/app.config.ts` adds them to the Expo configuration. After adding or removing a native plugin, run `bun run mobile:prebuild` and rebuild the app. TypeScript checks none of the Kotlin or Swift; it compiles only in a native build. `plugins/intent-scanner` (Android, runtime receiver, no config plugin) and `plugins/managed-config` (Android and iOS, with a config plugin) are the references.

## Trust boundary

The platform declares no capabilities: a deployment that needs raw sockets, an inbound listener or a child process refuses to start here, naming what needs it. HTTPS clients still go through the network port that plugins provide.

Ownership is an `EXCLUSIVE` transaction on the lock database, held while the authority is open. A second open in the same runtime is refused before SQLite is asked, which covers a background task started while the screens hold the workspace. `defineBackgroundDelivery` therefore takes a function that returns the open authority instead of opening its own.

The screens act as the local owner, the person holding the device. The app's sandbox is the only isolation between apps; anyone who can unlock the device can use the app. Pairing and device credentials belong to a plugin, not to this package; it supplies the secret store they are kept in. `expoSecretStore` uses `expo-secure-store` (Keychain on iOS, Keystore-encrypted storage on Android) with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, so a background task can read it after the first unlock and the value is not restored onto another device.

`connectMobileShell` attaches the mobile shell adapter to the shell port in-process, as the device's owner, because the OS runs in the same process as the authority; there is no shell route on the device. A link or file the OS opens the app with is submitted to the port, and what the port delivers is held, at most 16 and oldest dropped, until the frame subscribes. An opened resource is checked readable by the owner with its kind's read query before it is shown. A blob file is staged in the authority's blob store as the owner, and staged blobs do not survive a restart. Without a plugin that provides the shell port, nothing is attached, read or submitted.

Integration loops run only in the foreground (`followAppState`). A background pass is one bounded `drain` and `sync`; the OS decides when it runs and may stop it, and iOS runs it rarely, so delivery is effectively a foreground job there.

## Dependencies

Framework: `@agent-native/kernel`, `@agent-native/adapters` (only the portable `sql-driver`, `snapshot-storage`, `exclusive-lock` and `direct-transport` modules), `@agent-native/runtime`, `@agent-native/contracts`. Framework, for OS integration: `@agent-native/shell`. Expo entry: `expo-sqlite`, `expo-file-system`, `expo-crypto`, `expo-background-task`, `expo-task-manager`, `expo-modules-core`, `react-native`. `check:boundaries` treats `src/` as portable: no Node or Bun import or global.

## Tests

```sh
bun test packages/mobile
bun run test:portable
```

`test/mobile.test.ts` opens the platform with Bun's SQLite and file blob store in place of Expo's. It covers a capture with a photo committed, closed and found again after reopen; a second open refused while the first holds the workspace; a deployment with an ingress destination refused on iOS; a workspace name that tries to leave the sandbox; and the foreground, background and background-pass calls. `test/native-module.test.ts` covers a plugin's native module found by its manifest name and the refusal when the build lacks it. `test:portable` runs the same suite with the Hermes gaps removed. The Expo bindings are only exercised on a device or emulator.

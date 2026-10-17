# @agent-native/mobile

The host platform for Android and iOS. It runs the same kernel and runtime as the desktop host inside the app: one workspace per application, owned by the app while its authority is open, stored in the device's SQLite with blobs in the app's documents. The screens call the authority in-process through the direct transport. There is no listener, no session and no child process.

Layer: framework (`packages/*`). The mobile starter in `apps/mobile` uses it; content never imports it.

## Primitives

- [Host platform](../../docs/primitives.md#host-platform): `createMobilePlatform`, `MobileBindings`, and on Expo `expoPlatform`, `expoSqlDriver` and `expoBlobStore`.
- [Authority](../../docs/primitives.md#authority): `openMobileAuthority`, `MobileAuthority`, `MobileAuthorityOptions`; on Expo `followAppState` and `defineBackgroundDelivery`.

## Entrypoints

| Import                      | Runs in               | Contents                                                                                                                            |
| --------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/mobile`      | any host              | `createMobilePlatform` over injected bindings and `openMobileAuthority`. No Expo or React Native import, so Bun tests run it.       |
| `@agent-native/mobile/expo` | React Native (Hermes) | The Expo bindings. Importing it installs the Web globals Hermes lacks, with `expo-crypto` as the random source, so import it first. |

`src/expo/` holds the parts that import Expo: the SQLite driver on `expo-sqlite`'s synchronous API with a new connection per driver, the blob store on `expo-file-system`, and the app lifecycle (`AppState` and `expo-background-task`). The root TypeScript project excludes that folder; `tsconfig.native.json` checks it.

A workspace on a device is a name (`field`), not a path, so a configured value cannot address files outside the app's sandbox. Its databases are `<name>.workspace.sqlite` and `<name>.lock.sqlite` in Expo's database directory, and its blobs are in `agent-native/<name>/blobs` under the document directory.

## Trust boundary

The platform declares no capabilities: a deployment that needs raw sockets, an inbound listener or a child process refuses to start here, naming what needs it. HTTPS clients still go through the network port that plugins provide.

Ownership is an `EXCLUSIVE` transaction on the lock database, held while the authority is open. A second open in the same runtime is refused before SQLite is asked, which covers a background task started while the screens hold the workspace. `defineBackgroundDelivery` therefore takes a function that returns the open authority instead of opening its own.

The screens act as the local owner, the person holding the device. The app's sandbox is the only isolation between apps; anyone who can unlock the device can use the app. Pairing and device credentials belong to a plugin, not to this package.

Integration loops run only in the foreground (`followAppState`). A background pass is one bounded `drain` and `sync`; the OS decides when it runs and may stop it, and iOS runs it rarely, so delivery is effectively a foreground job there.

## Dependencies

Framework: `@agent-native/kernel`, `@agent-native/adapters` (only the portable `sql-driver`, `snapshot-storage`, `exclusive-lock` and `direct-transport` modules), `@agent-native/runtime`, `@agent-native/contracts`. Expo entry: `expo-sqlite`, `expo-file-system`, `expo-crypto`, `expo-background-task`, `expo-task-manager`, `react-native`. `check:boundaries` treats `src/` as portable: no Node or Bun import or global.

## Tests

```sh
bun test packages/mobile
bun run test:portable
```

`test/mobile.test.ts` opens the platform with Bun's SQLite and file blob store in place of Expo's. It covers a capture with a photo committed, closed and found again after reopen; a second open refused while the first holds the workspace; a deployment with an ingress destination refused on iOS; a workspace name that tries to leave the sandbox; and the foreground, background and background-pass calls. `test:portable` runs the same suite with the Hermes gaps removed. The Expo bindings are only exercised on a device or emulator.

# @agent-native/intent-scanner

The intent scanner host plugin. Rugged Android devices (Zebra, Honeywell, Datalogic and others) scan with a built-in imager and hand each scan to apps as a broadcast intent, configured in the vendor's scanner app. This plugin brings a native receiver for those intents and a scanner source that decodes each one through the same `decodeScan` as the wedge, serial, HID and camera sources, so prefixes, AIM identifiers and GS1 parsing follow the profile and scan routes work unchanged.

Layer: plugins (`plugins/*`). Android only: iOS has no broadcast intents, so an application that targets iOS leaves this plugin out on that platform.

## Primitives

- [Input source](../../docs/primitives.md#input-source): `createIntentSource`, `IntentScannerModule`, and on the device `intentSource`. A profile with `transport: 'intent'` names the action, the data extra and an optional sender permission.
- [Host plugin](../../docs/primitives.md#host-plugin): `intentScannerPlugin`, `intentScannerPluginManifest`. The manifest names the native module `AgentNativeIntentScanner`; the plugin adds no operations and refuses startup in a build without the module.
- [Native frame](../../docs/primitives.md#native-frame): `intentScannerScreens(profile)`, a scanner test screen at `/scanner/intent` that lists decoded scans while setting up the device.

## Entrypoints

| Import                                               | Runs in               | Contents                                                                                              |
| ---------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `@agent-native/intent-scanner/plugin-manifest`       | browser and any host  | `intentScannerPluginManifest`: platforms `android`, native module `AgentNativeIntentScanner`.         |
| `@agent-native/intent-scanner/source`                | any host              | `createIntentSource(profile, module)` over an injected module, so Bun tests run it.                   |
| `@agent-native/intent-scanner/plugin`                | React Native (Hermes) | `intentScannerPlugin`, for `defineApplication({ plugins })`. Checks the native module at `open`.      |
| `@agent-native/intent-scanner/expo`                  | React Native (Hermes) | `intentSource(profile)`, the source bound to the native module through `requireOptionalNativeModule`. |
| `@agent-native/intent-scanner/plugin-screens-native` | React Native (Hermes) | `intentScannerScreens(profile)`, for the application's `screens-native` `plugins`.                    |

The native part is an Expo module: `expo-module.config.json` and `android/` with `IntentScannerModule.kt`. Expo autolinking finds it through the root `node_modules`; no config plugin is needed because the receiver is registered at runtime. The module exposes `listen(action, dataExtra, senderPermission)`, `stop(action)` and the `onScan` event with `{ action, text }`. One receiver exists per action, and it is unregistered when the last source for that action stops or the module is destroyed. TypeScript does not check the Kotlin, and `bun run check` does not compile it.

Example profiles, as data for the scanner configuration module. Check the extras against the device's manual; both vendors let the action be renamed.

```json
{
  "id": "zebra-datawedge",
  "label": "Zebra DataWedge",
  "transport": "intent",
  "terminator": "none",
  "maxGapMs": 50,
  "minLength": 1,
  "aimIds": false,
  "scannerLayout": "us",
  "intent": { "action": "dev.agentnative.SCAN", "dataExtra": "com.symbol.datawedge.data_string" }
}
```

In DataWedge, the profile associated with the app enables Intent Output with that action and Intent Delivery set to Broadcast intent. For Honeywell devices, the scanner settings' Data Intent sends the configured action with the data in the `data` extra; use `"dataExtra": "data"`.

Without hardware, an emulator or any Android device can stand in for the scanner app:

```sh
adb shell am broadcast -a dev.agentnative.SCAN --es com.symbol.datawedge.data_string 4006381333931
```

## Trust boundary

The receiver is exported, because the scanner app runs in another process, so any app on the device can send the action unless the profile sets `senderPermission`. A scan is input under the person's authority, like a keystroke from a wedge scanner: a route turns it into a command that policy still authorizes. Set a sender permission that only the scanner app holds where injected scans matter. The receiver reads one string extra and ignores intents for other actions.

The plugin holds no state, declares no settings and reaches no network.

## Dependencies

Framework: `@agent-native/kernel` (`plugin`, `plugin-manifest`), `@agent-native/devices` (the portable `scanner/decode`, `scanner/profile` and `scanner/source` modules), `@agent-native/mobile/expo` (`pluginNativeModule`), `@agent-native/frame-native` (screens). External: `expo-modules-core`, `react`, `react-native`, `lucide-react-native`; on Android, `androidx.core` for `ContextCompat.registerReceiver`. `check:boundaries` treats `src/` as portable because the manifest lists a mobile platform.

## Tests

```sh
bun test plugins/intent-scanner
```

`test/source.test.ts` drives `createIntentSource` with a fake module standing in for the receiver: the receiver is registered with the profile's sender permission, a broadcast becomes a decoded GS1 scan with its AIM symbology, broadcasts for another action and after stopping are ignored, stopping unregisters the receiver, and a missing module or a profile without `intent` reports the source unsupported. Profiles refuse actions and extras that are not Android names, and the manifest runs on Android only. The Kotlin receiver has not been compiled or run; the device test with `adb shell am broadcast` runs on demand.

## Skills

- [add-scanner-input](../../packages/devices/skills/add-scanner-input/SKILL.md): scanner sources, profiles and routes.

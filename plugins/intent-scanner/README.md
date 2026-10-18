# @agent-native/intent-scanner

The intent scanner [host plugin](../../docs/glossary.md#host-plugin) reads scans from rugged Android devices, such as Zebra, Honeywell and Datalogic. These devices scan with a built-in imager and hand each scan to other software as a broadcast intent, configured in the vendor's scanner software. The plugin brings a native receiver for those intents and an [input source](../../docs/glossary.md#input-source) that decodes each one through the same `decodeScan` as the wedge, serial, HID and camera sources. Prefixes, AIM identifiers and GS1 parsing therefore follow the [scanner profile](../../docs/glossary.md#scanner-profile), and scan routes work unchanged. [Point-of-work input](../../docs/point-of-work-input.md#sources) describes the sources.

## Layer

Plugins (`plugins/*`). Android only. iOS has no broadcast intents, so an application that targets iOS leaves this plugin out on that platform.

## Primitives

- [Input source](../../docs/primitives.md#input-source): `createIntentSource`, `IntentScannerModule`, and on the device `intentSource`. A profile with `transport: 'intent'` names the action, the data extra and an optional sender permission.
- [Host plugin](../../docs/primitives.md#host-plugin): `intentScannerPlugin` and `intentScannerPluginManifest`. The manifest names the native module `AgentNativeIntentScanner`. The plugin adds no [capabilities](../../docs/glossary.md#capability) and refuses startup in a build without the module.
- [Native frame](../../docs/primitives.md#native-frame): `intentScannerScreens(profile)`, a scanner test [screen](../../docs/glossary.md#screen) at `/scanner/intent` that lists decoded scans while the device is set up.

## Entrypoints

| Import                                               | Runs in               | Contents                                                                                              |
| ---------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `@agent-native/intent-scanner/plugin-manifest`       | browser and any host  | `intentScannerPluginManifest`: platforms `android`, native module `AgentNativeIntentScanner`.         |
| `@agent-native/intent-scanner/source`                | any host              | `createIntentSource(profile, module)` over an injected module, so Bun tests run it.                   |
| `@agent-native/intent-scanner/plugin`                | React Native (Hermes) | `intentScannerPlugin`, for `defineApplication({ plugins })`. Checks the native module at `open`.      |
| `@agent-native/intent-scanner/expo`                  | React Native (Hermes) | `intentSource(profile)`, the source bound to the native module through `requireOptionalNativeModule`. |
| `@agent-native/intent-scanner/plugin-screens-native` | React Native (Hermes) | `intentScannerScreens(profile)`, for the application's `screens-native` `plugins`.                    |

### Native module

The native part is an Expo module: `expo-module.config.json`, and `android/` with `IntentScannerModule.kt`. Expo autolinking finds it through the root `node_modules`. No config plugin is needed, because the receiver is registered at run time. The module exposes:

- `listen(action, dataExtra, senderPermission)`;
- `stop(action)`;
- the `onScan` event with `{ action, text }`.

One receiver exists per action. It is unregistered when the last source for that action stops or the module is destroyed. TypeScript does not check the Kotlin, and `bun run check` does not compile it.

### Example profiles

The profiles below are data for the scanner configuration module. Check the extras against the device's manual, because both vendors let the action be renamed.

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

In DataWedge, the profile associated with the application enables Intent Output with that action, and sets Intent Delivery to Broadcast intent. On Honeywell devices, the scanner settings' Data Intent sends the configured action with the data in the `data` extra, so use `"dataExtra": "data"`.

Without hardware, an emulator or any Android device can stand in for the scanner software:

```sh
adb shell am broadcast -a dev.agentnative.SCAN --es com.symbol.datawedge.data_string 4006381333931
```

## Trust boundary

The receiver is exported, because the scanner software runs in another process. Any other software on the device can therefore send the action, unless the profile sets `senderPermission`. A scan counts as the person's own input, like a keystroke from a wedge scanner. A route turns it into a [command](../../docs/glossary.md#command) that [policy](../../docs/glossary.md#policy) still authorizes.

Where injected scans matter, set a sender permission that only the scanner software holds. The receiver reads one string extra and ignores intents for other actions. The plugin holds no state, declares no settings and reaches no network.

## Dependencies

- Framework:
  - `@agent-native/kernel`: `plugin` and `plugin-manifest`;
  - `@agent-native/devices`: the portable `scanner/decode`, `scanner/profile` and `scanner/source` modules;
  - `@agent-native/mobile/expo`: `pluginNativeModule`;
  - `@agent-native/frame-native`, for the screens.
- External: `expo-modules-core`, `react`, `react-native` and `lucide-react-native`; on Android, `androidx.core` for `ContextCompat.registerReceiver`.

`check:boundaries` treats `src/` as portable, because the manifest lists a mobile platform.

## Tests

```sh
bun test plugins/intent-scanner
```

`test/source.test.ts` drives `createIntentSource` with a fake module standing in for the receiver. It covers:

- the receiver registered with the profile's sender permission;
- a broadcast that becomes a decoded GS1 scan with its AIM symbology;
- broadcasts for another action, and after stopping, ignored;
- stopping, which unregisters the receiver;
- a missing module, or a profile without `intent`, which reports the source unsupported;
- profiles that refuse actions and extras that are not Android names;
- the manifest, which runs on Android only.

The Kotlin receiver has not been compiled or run. The device test with `adb shell am broadcast` runs on demand.

## Skills

- [add-scanner-input](../../packages/devices/skills/add-scanner-input/SKILL.md): scanner sources, profiles and routes.

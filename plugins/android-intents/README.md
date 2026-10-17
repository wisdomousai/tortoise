# @agent-native/android-intents

The Android intents host plugin. It serves the application's `intent` OS handlers (an activity intent with the application's own action, sent by another app) and `intent` OS actions (an explicit intent the application starts in another app), on top of the [OS plugin](../os/README.md), which it requires. Without it, startup refuses an application that declares an intent handler or action. It brings the Android module `AgentNativeOsIntents` that carries intents between the OS and the mobile shell.

Layer: plugins (`plugins/*`), shipped with the framework. The TypeScript runs in the authority on every platform; the Kotlin module is in Android builds only.

## Primitives

- [OS handler](../../docs/primitives.md#os-handler): enabling `intent` handlers. The mobile shell in `@agent-native/mobile` submits each received intent to the shell port, which matches it by action, categories, data scheme and MIME type and checks its extras with the handler's schema.
- [OS action](../../docs/primitives.md#os-action): enabling `intent` actions. The instruction is built from the declaration (action, package) and the caller's extras, checked against the declared schema, and started by the attached Android adapter.
- [Host plugin](../../docs/primitives.md#host-plugin): `androidIntentsPlugin`, `openAndroidIntents`, `androidIntentsPluginManifest`.

## Entrypoints

| Import                                          | Runs in            | Contents                                                     |
| ----------------------------------------------- | ------------------ | ------------------------------------------------------------ |
| `@agent-native/android-intents`                 | server and device  | Everything listed under Primitives.                          |
| `@agent-native/android-intents/plugin-manifest` | browser and server | `androidIntentsPluginManifest`. No module and no setting.    |
| `@agent-native/android-intents/plugin`          | server and device  | `androidIntentsPlugin` and `openAndroidIntents`.             |
| `android/`, `expo-module.config.json`           | Android            | `OsIntentsModule`, the native module `AgentNativeOsIntents`. |

The framework owns the rest of the path, so a forked starter keeps it without naming this plugin:

- `nativeOsConfig` in `@agent-native/shell` lists `@agent-native/mobile/intent-filters` among the Expo config plugins when an intent handler is declared. It writes an intent filter per handler on the main activity, with the action and categories named as declared plus `DEFAULT`. Expo's own `android.intentFilters` prefixes every name with `android.intent.action.`, so it cannot carry an application's own actions.
- `expoOsBindings` in `@agent-native/mobile/expo` binds `intents` and `startIntent` when the build has `AgentNativeOsIntents` (`expoIntentBindings`, `OsIntentsNativeModule`), and leaves them out otherwise. `connectMobileShell` reports an Android build that declares intent handlers but lacks the module.

On the desktop, the web and iOS the plugin opens and enables the kinds, nothing arrives, and an intent action is refused as `failed` by the adapter.

## Trust boundary

An intent comes from any app on the device, so it is an unsolicited OS request: it only opens or prefills, and the person confirms through the form it opens. The module passes on an intent only when its action is one of the declared handlers' actions, and reads only the extras that handler declares, with the declared type and typed getters. It never unpacks the other extras a sender put in. When the sender's bundle cannot be read, the intent goes on without extras, and the handler's schema refuses it if it needs them. The launching intent is passed on once per process, and a launch from the recents list, which replays it, is ignored. The mobile shell checks the record again as unknown input before it submits it, and the OS plugin parses, matches, rate-limits and audits it like any request. The intent's referrer is not shown as its source, because the sender sets it.

An intent action names its package in the declaration, and the catalog refuses one without a package. So the action and extras go only to that app, never to whichever app also declares the action. The caller supplies extras only, checked against the declared schema; the action, package and data classes come from the declaration. The device checks the instruction against the declared action again before it starts it. Extras are flat strings, numbers and booleans. A whole number goes as an Android `int` when it fits and a `long` otherwise.

## Dependencies

Framework: `@agent-native/kernel` (`plugin`, `plugin-manifest`). Plugin: `@agent-native/os`. Native: `expo-modules-core`, with the module autolinked from the root `node_modules`. Tests also use `@agent-native/contracts`, `@agent-native/mobile`, `@agent-native/shell` and `@agent-native/adapters`.

## Tests

```sh
bun test plugins/android-intents
```

`test/mobile.test.ts` runs a fixture notes application on the mobile authority with Bun bindings for the device. It covers:

- the device listening for the declared action and its typed extras only;
- the launching intent prefilling the form with its provenance;
- an undeclared action, an extra the schema refuses, an undeclared extra and a malformed record showing nothing;
- an intent action starting the declared package with the checked extras;
- a caller's package or out-of-range extra being refused;
- an iOS device without the module refusing intent actions and reporting nothing;
- an Android build without the module saying so;
- startup refused without the plugin.

The intent matching, listening and instruction checks are tested in `packages/shell/test/intents.test.ts`, and the config plugin in `packages/mobile/test/intent-filters.test.ts`. The Kotlin module is not compiled by `bun run check`.

# @agent-native/android-intents

This [host plugin](../../docs/glossary.md#host-plugin) connects an [application](../../docs/glossary.md#application) to Android intents in both directions. It serves `intent` [OS handlers](../../docs/glossary.md#os-handler), which receive an activity intent with the application's own action from another app. It serves `intent` [OS actions](../../docs/glossary.md#os-action), which start an explicit intent in another app.

## Layer

Plugin layer, shipped with the framework. The TypeScript runs in the [authority](../../docs/glossary.md#authority) on every platform. The Kotlin module `AgentNativeOsIntents` carries intents between the OS and the mobile host, and is in Android builds only. The plugin runs on top of the [OS plugin](../os/README.md), which it requires. Without the plugin, startup refuses an application that declares an intent handler or action. It trusts the application's declarations and treats every intent from another app as input.

## Primitives

- [OS handler](../../docs/primitives.md#os-handler): enables `intent` handlers. The mobile host in `@agent-native/mobile` submits each received intent to the [shell port](../../docs/glossary.md#shell-port). The port matches it by action, categories, data scheme and MIME type, and checks its extras with the handler's schema.
- [OS action](../../docs/primitives.md#os-action): enables `intent` actions. The instruction is built from the declared action and package and the caller's extras, checked against the declared schema. The attached Android adapter starts it.
- [Host plugin](../../docs/primitives.md#host-plugin): `androidIntentsPlugin`, `openAndroidIntents`, `androidIntentsPluginManifest`.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/android-intents` | server and device | Everything listed under Primitives. |
| `@agent-native/android-intents/plugin-manifest` | browser and server | `androidIntentsPluginManifest`, with no module and no setting. |
| `@agent-native/android-intents/plugin` | server and device | `androidIntentsPlugin` and `openAndroidIntents`. |
| `android/`, `expo-module.config.json` | Android | `OsIntentsModule`, the native module `AgentNativeOsIntents`. |

### Framework parts

The framework owns the rest of the path, so a forked starter keeps it without naming this plugin:

- `nativeOsConfig` in `@agent-native/shell` adds `@agent-native/mobile/intent-filters` to the Expo config plugins when an intent handler is declared. That config plugin writes one intent filter per handler on the main activity, with the declared action and categories plus `DEFAULT`.
- Expo's own `android.intentFilters` prefixes every name with `android.intent.action.`, so it cannot carry an application's own actions.
- `expoOsBindings` in `@agent-native/mobile/expo` binds `intents` and `startIntent` through `expoIntentBindings` when the build has `AgentNativeOsIntents`. Without the module it leaves them out. `OsIntentsNativeModule` is the module's type.
- `connectMobileShell` reports an Android build that declares intent handlers but lacks the module.

On the desktop, the web and iOS, the plugin opens and enables both kinds. No intent arrives there, and the adapter refuses an intent action as `failed`.

## Trust boundary

An intent can come from any app on the device, so it is an unsolicited OS request. It only opens or prefills a form, and the [person](../../docs/glossary.md#person) confirms through that form. The module checks each intent before passing it on:

- it passes on an intent only when its action is a declared handler's action;
- it reads only the extras that handler declares, with the declared type and typed getters, and never unpacks other extras;
- an unreadable sender bundle sends the intent on without extras, and the handler's schema refuses it if it needs them;
- it passes on the launching intent once per process, and ignores a launch from the recents list, which replays it.

The mobile host checks the record again as unknown input before it submits it. The OS plugin then parses, matches, rate-limits and audits it like any request. The intent's referrer is not shown as its source, because the sender sets it.

An intent action names its package in the declaration, and the catalog refuses one without a package. The action and extras therefore go only to that app, never to another app that declares the same action. The [caller](../../docs/glossary.md#caller) supplies only the extras, checked against the declared schema. The action, package and data classes come from the declaration. The device checks the instruction against the declared action again before it starts it.

Extras are flat strings, numbers and booleans. A whole number goes as an Android `int` when it fits and as a `long` otherwise.

## Dependencies

- Framework: `@agent-native/kernel` (`plugin`, `plugin-manifest`).
- Plugin: `@agent-native/os`.
- Native: `expo-modules-core`, with the module autolinked from the root `node_modules`.
- Tests only: `@agent-native/contracts`, `@agent-native/mobile`, `@agent-native/shell` and `@agent-native/adapters`.

## Tests

```sh
bun test plugins/android-intents
```

- `test/mobile.test.ts` runs a fixture notes application on the mobile authority, with Bun bindings for the device. It covers:
  - the device listening for the declared action and its typed extras only;
  - the launching intent prefilling the form with its provenance;
  - an undeclared action, an extra the schema refuses, an undeclared extra and a malformed record showing nothing;
  - an intent action starting the declared package with the checked extras;
  - a caller's package or out-of-range extra being refused;
  - an iOS device without the module refusing intent actions and reporting nothing;
  - an Android build without the module saying so;
  - startup refused without the plugin.
- `packages/shell/test/intents.test.ts` covers intent matching, listening and the instruction checks.
- `packages/mobile/test/intent-filters.test.ts` covers the config plugin.

`bun run check` does not compile the Kotlin module.

## Skills

- [add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md): OS handlers, actions and native registrations.

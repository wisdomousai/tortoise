# @agent-native/os-shortcuts

The OS shortcuts host plugin. It serves the application's `shortcut` OS handlers, launcher entries such as "New task", on top of the [OS plugin](../os/README.md), which it requires. Without it, startup refuses an application that declares a shortcut handler.

Layer: plugins (`plugins/*`), shipped with the framework. It runs in the authority on every platform and brings no native code.

## Primitives

- [OS handler](../../docs/primitives.md#os-handler): enabling `shortcut` handlers.
- [Host plugin](../../docs/primitives.md#host-plugin): `osShortcutsPlugin`, `openOsShortcuts`, `osShortcutsPluginManifest`.

## Entrypoints

| Import                                       | Runs in            | Contents                                                  |
| -------------------------------------------- | ------------------ | --------------------------------------------------------- |
| `@agent-native/os-shortcuts`                 | server and device  | Everything listed under Primitives.                       |
| `@agent-native/os-shortcuts/plugin-manifest` | browser and server | `osShortcutsPluginManifest`. No module and no setting.    |
| `@agent-native/os-shortcuts/plugin`          | server and device  | `osShortcutsPlugin` and `openOsShortcuts`.                |

Every launcher opens the application with the shortcut's link, `<scheme>:///?os-shortcut=<id>` (`shortcutLink` in `@agent-native/shell`), or `/?os-shortcut=<id>` on the web. The shell submits it like any link, and the shell port reads it as that shortcut before matching links. The framework registers the launchers from the shortcut handlers, so a forked starter keeps them without naming this plugin:

- macOS: the dock menu, set by the Electron shell (`apps/desktop/src/os-shell.ts`) once it has read the declarations. A click hands it the shortcut link.
- Windows: the jump list's tasks, each starting the app with `--` before the link, like the scheme registration. A running instance receives the link as second-instance data.
- Android: static app shortcuts, written at prebuild by `@agent-native/mobile/shortcuts`, which `nativeOsConfig` lists. Each is a VIEW intent to the main activity carrying the link, which `Linking` reports.
- Web: the manifest's `shortcuts`, which an installed Chromium app offers.
- Linux has no desktop actions, because the `dir` target writes no desktop file. iOS has no quick actions; they need a native handler for the chosen item, which is not built.

## Trust boundary

Any app or page can open the shortcut link, as any page can open the web landing, so a shortcut is an unsolicited OS request: it only opens or prefills, and the person confirms through the form it opens. A shortcut link carries an id and nothing else. A host, a path, a fragment, credentials or any other parameter make it an ordinary link, and an undeclared id is refused as `no-handler`. The OS plugin parses, matches, rate-limits and audits it like any request. The catalog refuses a shortcut title longer than 64 characters or with a control character, because launchers write it into a menu, a jump list and Android string resources.

## Dependencies

Framework: `@agent-native/kernel` (`plugin`, `plugin-manifest`). Plugin: `@agent-native/os`. Tests also use `@agent-native/contracts`, `@agent-native/mobile`, `@agent-native/shell` and `@agent-native/adapters`.

## Tests

```sh
bun test plugins/os-shortcuts
```

`test/shortcuts.test.ts` runs a fixture notes application on the mobile authority. It covers the shortcut link a launcher opens prefilling the form with its provenance, an undeclared shortcut and a shortcut link with more in it being refused, and startup refused without the plugin. The link form, the matching order and the registrations are tested in `packages/shell/test/shortcuts.test.ts`, and the Android config plugin in `packages/mobile/test/shortcuts-plugin.test.ts`. project-tasks' `e2e/os.pw.ts` opens its web shortcut.

## Skills

- [add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md): OS handlers, actions and native registrations.

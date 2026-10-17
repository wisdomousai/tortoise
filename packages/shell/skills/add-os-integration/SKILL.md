---
name: add-os-integration
description: Let the operating system reach an agent-native application, or let the application ask the OS for something. Use when adding a link, file type, share target, Android intent, launcher shortcut or notification reply as an OS handler, or an open, share, notify or intent OS action; when composing plugins/os, plugins/share-target, plugins/os-shortcuts, plugins/android-intents or plugins/notifications; or when the generated platform registrations (Expo, electron-builder, the web manifest, association files) need to change. Covers examples/<app>/os.ts, packages/contracts/src/os.ts and packages/shell.
---

# Add an OS integration

An application declares what the OS may send it (handlers) and what it may ask of the OS (actions) as data in an `OsDeclarations` object on its module. `packages/shell` matches requests and builds instructions from those declarations, and generates every platform registration from them. Host plugins serve each kind. `examples/project-tasks/os.ts` declares one of nearly every kind and is the worked reference. [OS handler](../../../../docs/primitives.md#os-handler) and [OS action](../../../../docs/primitives.md#os-action) list where each part lives.

## Before writing

- An OS request comes from an unauthenticated sender on the device. A handler only opens a resource the caller may read, navigates or prefills a form; it never commits. A person confirms through the form it opens. Shape the target as `open` or `prepare`, not as a command.
- Pick the kind and the plugin that serves it. Startup refuses a declared kind that no composed plugin serves.

| Kind | Handler or action | Plugin |
|---|---|---|
| `link`, `file`; `open`, `reveal`, `open-file` | both | `plugins/os` (base for all others) |
| `share` | both | `plugins/share-target` |
| `shortcut` | handler | `plugins/os-shortcuts` |
| `intent` (Android) | both | `plugins/android-intents` |
| `notify`, `reply` | action, handler | `plugins/notifications` |

## Steps

1. Declare the handler or action in the application's OS declarations (`os` on its module) with a stable `id`, a `description`, the kind's fields from `packages/contracts/src/os.ts`, and a JSON schema for `params` or extras. A template names only the request's own fields (`{taskId}`, `{file.stem}`).
2. List the serving plugin and `plugins/os` in the application's manifest and application entrypoints. A site turns individual ids off with the `os-disabled` setting.
3. For `notify`, follow the "What the application writes" list in the [notifications README](../../../../plugins/notifications/README.md#entrypoints): a notify action over outbox targets with `offline: 'queue'`, a `<target>.effect.settle` command per target, and a command that enqueues an `OsNotificationPayload` with the replies it offers.
4. Declare the data classes an action carries. Notification text leaves the authority for the lock screen.
5. Show the delivery in the screen: the web frame and `packages/frame-native` apply deliveries and show provenance (`describeProvenance`) above a prefilled form.

## Registrations

The generators in `@agent-native/shell/registrations` turn the same declarations into platform files, so no registration is written by hand:

- `nativeOsConfig` runs in `bun run mobile:prepare` (`scripts/mobile-entry.ts`) and adds the Expo config plugins for shares, notifications, intent filters and shortcuts. Rerun `bun run mobile:prebuild` and rebuild the app after adding or removing a handler kind that brings a config plugin.
- `desktopOsConfig` runs in `bun run package:stage` for the electron-builder scheme and file associations.
- `webManifestOs` runs in the frame's Vite plugin (`packages/frame/vite.ts`) for the web manifest's protocol handlers, share target and shortcuts.
- `associationFiles` writes `apple-app-site-association` and `assetlinks.json` for verified links: `bun scripts/os-associations.ts --team-id <id> --sha256-cert <fingerprint>`. Verified links register only for hosts the deployment configures (`os-link-hosts`, `AGENT_NATIVE_OS_LINK_HOSTS`).

## Checks

```sh
bun test packages/shell
bun test plugins/os plugins/<plugin>
bun test examples/<app>
bunx playwright test examples/<app>/e2e
```

Each plugin README lists what its `test/mobile.test.ts` covers on the mobile authority with Bun bindings for the device. `examples/project-tasks/test/os.test.ts` covers the desktop path over HTTP and `examples/project-tasks/e2e/os.pw.ts` the browser. The Kotlin module of `plugins/android-intents` and the Expo config plugins compile only in a native build; record a device or emulator run in [implementation status](../../../../docs/implementation-status.md#os-integration) separately from the Bun tests.

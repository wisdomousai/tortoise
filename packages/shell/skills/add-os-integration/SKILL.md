---
name: add-os-integration
description: Let the operating system reach an agent-native application, or let the application ask the OS for something. Use when adding a link, file type, share target, Android intent, launcher shortcut or notification reply as an OS handler, or an open, share, notify or intent OS action; when composing plugins/os, plugins/share-target, plugins/os-shortcuts, plugins/android-intents or plugins/notifications; or when the generated platform registrations (Expo, electron-builder, the web manifest, association files) need to change. Covers showcase/examples/<app>/os.ts, packages/contracts/src/os.ts and packages/shell.
---

# Add an OS integration

An application declares what the OS may send it and what it may ask of the OS as data, in an `OsDeclarations` object on its module. The first kind is an OS handler, the second an OS action. `packages/shell` matches requests and builds instructions from those declarations, and generates every platform registration from them. Host plugins serve each kind. `showcase/examples/field-service/os.ts` declares one of nearly every kind and is the worked reference; its work order screen runs the open and share actions with `runOsAction`. `showcase/examples/asset-survey-field/os.ts` is the phone reference: an intent handler that opens a resource, and intent, share and notify actions that native screens and inbound sync use.

## Before writing

- Treat an OS request as coming from an unauthenticated sender on the device. A handler only opens a resource the caller may read, navigates or prefills a form. It never commits; a person confirms through the form it opens.
- Give the handler an `open` or `prepare` target, never a command. A `prepare` target fills a command's form for a person to confirm.
- Pick the kind and the plugin that serves it. Startup refuses a declared kind that no composed plugin serves.

| Kind | Handler or action | Plugin |
|---|---|---|
| `link`, `file`; `open`, `reveal`, `open-file` | both | `plugins/os` (base for all others) |
| `share` | both | `plugins/share-target` |
| `shortcut` | handler | `plugins/os-shortcuts` |
| `intent` (Android) | both | `plugins/android-intents` |
| `notify`, `reply` | action, handler | `plugins/notifications` |

## Steps

1. Declare the handler or action in the application's OS declarations (`os` on its module). Give it a stable `id`, a `description`, the kind's fields from `packages/contracts/src/os.ts`, and a JSON schema for `params` or extras.
2. Name only the request's own fields in a template, such as `{taskId}` or `{file.stem}`.
   - An `open` target's kind must be listed in the application's `selectableResources`, with a read query that takes `{ id }`. The host and the mobile shell run that query as the caller before the frame sees the delivery, and drop it when the read fails.
   - The screens map the kind to a screen in `resources` of `defineScreens` or `defineNativeScreens`.
3. List the serving plugin and `plugins/os` in the application's manifest and application entrypoints. A site turns individual IDs off with the `os-disabled` setting.
4. For `notify`, write these ([notifications README](../../../../plugins/notifications/README.md)):
   - a notify action over outbox targets with `offline: 'queue'`;
   - a `<target>.effect.complete` command per target. It calls `ctx.completeEffect` and then `ctx.change(effect.resource)`, because a command that touches an effect must change the effect's resource;
   - a command that enqueues an `OsNotificationPayload` with the replies it offers.
5. Declare the data classes an action includes. Notification text leaves the instance for the lock screen.
6. Show the delivery on the screen. The web frame and `packages/frame-native` apply deliveries and show provenance (`describeProvenance`) above a prefilled form. A screen asks for an action with `runOsAction` from the web frame's `@/lib/os-browser`, or `useOsAction` from `@tortoise/frame-native/os-actions` on a device.
7. Write no platform registration by hand. The generators in `@tortoise/shell/registrations` turn the same declarations into platform files:
   - `nativeOsConfig` runs in `bun run mobile:prepare` (`scripts/mobile-entry.ts`) and adds the Expo config plugins for shares, notifications, intent filters and shortcuts;
   - `desktopOsConfig` runs in `bun run package:stage` for the electron-builder scheme and file associations;
   - `webManifestOs` runs in the frame's Vite plugin (`packages/frame/vite.ts`) for the web manifest's protocol handlers, share target and shortcuts.
8. Rerun `bun run mobile:prebuild` and rebuild the mobile application after adding or removing a handler kind that brings a config plugin.
9. For verified links, write `apple-app-site-association` and `assetlinks.json` with `associationFiles` from `@tortoise/shell/associations`. Verified links register only for hosts the deployment configures in `os-link-hosts` or `TORTOISE_OS_LINK_HOSTS`.

   ```sh
   bun scripts/os-associations.ts --team-id <id> --sha256-cert <fingerprint>
   ```

## Checks

```sh
bun test packages/shell
bun test plugins/os plugins/<plugin>
bun test showcase/examples/<app>
bunx playwright test showcase/examples/<app>/e2e
```

- Each serving plugin's `test/mobile.test.ts` runs the mobile instance with Bun bindings for the device.
- `showcase/examples/field-service/test/os.test.ts` covers the desktop path over HTTP.
- `showcase/examples/asset-survey-field/test/os.test.ts` covers a phone with faked bindings: an intent, a notice queued by inbound sync, an intent action and a share.
- `showcase/examples/field-service/e2e/os.pw.ts` covers the browser, including an open action in a new browsing context and a share through the Web Share API.

The Kotlin module of `plugins/android-intents` and the Expo config plugins compile only in a native build. Record a device or emulator run in [implementation status](../../../../docs/implementation-status.md#os-integration), separately from the Bun tests.

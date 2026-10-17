# @agent-native/share-target

The share target host plugin. It serves the application's `share` OS handlers (text, a link or a file another app shares to it) and `share` OS actions (the system share sheet), on top of the [OS plugin](../os/README.md), which it requires. Without it, startup refuses an application that declares a share handler or action.

Layer: plugins (`plugins/*`), shipped with the framework. Server only, except `plugin-manifest`.

## Primitives

- [OS handler](../../docs/primitives.md#os-handler): the web share target route (`shareTargetRoute`) and the shares it holds under one-use codes (`createHeldShares`, `HeldShare`, `HeldShares`), resolved through `services.os.hold`.
- [OS action](../../docs/primitives.md#os-action): enabling `share` actions, which a page runs with `navigator.share` and an attached adapter runs through the system share sheet.
- [Host plugin](../../docs/primitives.md#host-plugin): `shareTargetPlugin`, `createShareTargetPlugin`, `openShareTarget`, `shareTargetPluginManifest`.

## Entrypoints

| Import                                       | Runs in            | Contents                                               |
| -------------------------------------------- | ------------------ | ------------------------------------------------------ |
| `@agent-native/share-target`                 | server only        | Everything listed under Primitives.                    |
| `@agent-native/share-target/plugin-manifest` | browser and server | `shareTargetPluginManifest`. No module and no setting. |
| `@agent-native/share-target/plugin`          | server only        | `shareTargetPlugin` and `createShareTargetPlugin`.     |
| `@agent-native/share-target/*`               | server only        | One source file: `open`, `route` or `held`.            |

Where a share comes from depends on the platform:

- Web: the generated web manifest declares a `share_target` that posts to `/os/share`. An installed Chromium app posts there; the plugin holds the post and redirects to `/?os-share=<code>`, and the frame submits `{ kind: 'claim', code }` as its session.
- Android and iOS: `mobile:prepare` adds the `expo-sharing` config plugin (an Android SEND filter, an iOS share extension) from the share handlers. `expo-sharing` opens the app with `<scheme>://expo-sharing`, and the mobile shell in `@agent-native/mobile` takes the shared items and submits them in-process. The plugin holds nothing there.
- Desktop: no OS shares to a desktop app. A share action opens the share menu on macOS only.

## Trust boundary

The share target's POST is a top-level navigation from whichever app or page shared, so it carries no session the host could trust; the route runs before the host's origin and session checks for that reason. It does not submit anything. It holds what was posted and the landing session claims it, so the request is attributed to that session and a file is staged in the blob store under it, where only that session can attach it, only through a command whose blob limits accept it. Any page can post a share and send the browser to its landing, so a share, like any unsolicited OS request, only prefills a form that the person confirms.

A post that is not `multipart/form-data` or `application/x-www-form-urlencoded`, has no `Content-Length` or is larger than the largest share handler accepts (plus 1 MiB for the form) is refused before it is read. A file whose media type no share handler accepts, or over that handler's `maxBytes`, is dropped unread. A code is 128 random bits, works once and expires after two minutes; at most eight posts are held and the oldest is dropped beyond that. Nothing is persisted, so a share not claimed before the host restarts is gone. The claim and the request it stands for are parsed, matched, rate-limited and audited by the OS plugin like any request.

## Dependencies

Framework: `@agent-native/kernel` (`plugin`, `plugin-manifest`, `application` types), `@agent-native/contracts`, `@agent-native/shell`, `@agent-native/runtime` types. Plugin: `@agent-native/os`. Tests also use `@agent-native/host`, `@agent-native/mobile` and `@agent-native/adapters`. `expo-sharing` is used by `@agent-native/mobile/expo`, not by this plugin.

## Tests

```sh
bun test plugins/share-target
```

`test/web.test.ts` serves a fixture notes application over HTTP. It covers shared text held and claimed once as a prefill, the cross-site landing, an unknown or reused code, a link and its text going to the link handler, a shared PDF staged for the claiming session, files of an undeclared type or over the limit dropped, refused methods, form types and oversized posts, expiry, the eight-post limit, a share action returned to the page, and startup refused without the plugin. `test/mobile.test.ts` runs the same application on the mobile authority with Bun bindings for the device: text and a PDF shared through the `expo-sharing` link prefill the form, an undeclared type is never read, and a share action opens the share sheet.

# @agent-native/share-target

The share target [host plugin](../../docs/glossary.md#host-plugin). It serves the application's `share` [OS handlers](../../docs/glossary.md#os-handler), for text, a link or a file another app shares to it. It also serves `share` [OS actions](../../docs/glossary.md#os-action), which open the system share sheet. It runs on top of the [OS plugin](../os/README.md), which it requires, and without it startup refuses an application that declares a share handler or action.

## Layer

Plugins (`plugins/*`), shipped with the framework. Server only, except `plugin-manifest`. The plugin trusts no session on an incoming share post. It relies on the OS plugin to attribute the claimed share to the landing session.

## Primitives

- [OS handler](../../docs/primitives.md#os-handler): the web share target route (`shareTargetRoute`) and the shares it holds under one-use codes (`createHeldShares`, `HeldShare`, `HeldShares`), resolved through `services.os.hold`.
- [OS action](../../docs/primitives.md#os-action): enabling `share` actions, which the browser runs with `navigator.share` and an attached adapter runs through the system share sheet.
- [Host plugin](../../docs/primitives.md#host-plugin): `shareTargetPlugin`, `createShareTargetPlugin`, `openShareTarget`, `shareTargetPluginManifest`.

## Entrypoints

| Import                                       | Runs in            | Contents                                               |
| -------------------------------------------- | ------------------ | ------------------------------------------------------ |
| `@agent-native/share-target`                 | server only        | Everything listed under Primitives.                    |
| `@agent-native/share-target/plugin-manifest` | browser and server | `shareTargetPluginManifest`. No module and no setting. |
| `@agent-native/share-target/plugin`          | server only        | `shareTargetPlugin` and `createShareTargetPlugin`.     |
| `@agent-native/share-target/*`               | server only        | One source file: `open`, `route` or `held`.            |

Where a share comes from depends on the platform:

- **Web**: the generated web manifest declares a `share_target` that posts to `/os/share`. An installed Chromium app posts there. The plugin holds the post and redirects to `/?os-share=<code>`, and the frame submits `{ kind: 'claim', code }` as its session.
- **Android and iOS**: `mobile:prepare` adds the `expo-sharing` config plugin from the share handlers. That plugin writes an Android SEND filter and an iOS share extension. `expo-sharing` opens the app with `<scheme>://expo-sharing`, and the mobile shell in `@agent-native/mobile` submits the shared items in-process. The plugin holds nothing there.
- **Desktop**: no OS shares to a desktop app. A share action opens the share menu on macOS only.

## Trust boundary

The share target's POST is a top-level navigation from whichever app or web page shared. It carries no session the host could trust, so the route runs before the host's origin and session checks. The route submits nothing. It holds what was posted, and the landing session claims it.

The claim attributes the request to the landing session. A file is staged in the [blob](../../docs/glossary.md#blob) store under that session. Only that session can attach it, and only through a command whose blob limits accept it. Any web page can post a share and send the browser to its landing. A share is therefore an unsolicited OS request, and it only prefills a form that the person confirms.

The route refuses a post before reading it when:

- its type is not `multipart/form-data` or `application/x-www-form-urlencoded`;
- it has no `Content-Length`;
- it is larger than the largest share handler accepts, plus 1,114,112 bytes (1 MiB and 64 KiB) for the form.

A file whose media type no share handler accepts, or over that handler's `maxBytes`, is dropped unread.

A code is 128 random bits, works once and expires after two minutes. At most eight posts are held, and the oldest is dropped beyond that. Nothing is persisted, so a share not claimed before the host restarts is gone. The OS plugin parses, matches, rate-limits and audits the claim and the request it stands for like any request.

## Dependencies

Framework: `@agent-native/kernel` (`plugin`, `plugin-manifest`, `application` types), `@agent-native/contracts`, `@agent-native/shell` and `@agent-native/runtime` types. Plugin: `@agent-native/os`. The tests also use `@agent-native/host`, `@agent-native/mobile` and `@agent-native/adapters`.

`expo-sharing` is used by `@agent-native/mobile/expo`, not by this plugin.

## Tests

```sh
bun test plugins/share-target
```

`test/web.test.ts` serves a fixture notes application over HTTP. It covers:

- shared text held and claimed once as a prefill, with the cross-site landing;
- an unknown or reused code;
- a link and its text going to the link handler;
- a shared PDF staged for the claiming session;
- files of an undeclared type or over the limit dropped;
- refused methods, form types and oversized posts;
- expiry and the eight-post limit;
- a share action returned to the browser, and startup refused without the plugin.

`test/mobile.test.ts` runs the same application on the mobile instance with Bun bindings for the device. It covers:

- text and a PDF shared through the `expo-sharing` link, prefilling the form;
- an undeclared type never read;
- a share action opening the share sheet.

`examples/asset-survey-field/test/os.test.ts` shares a capture's summary from an application on a phone.

## Skills

- [add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md): OS handlers, actions and native registrations.

# @agent-native/os

The OS host plugin. It provides the [shell port](../../docs/primitives.md#shell-port): a request the operating system delivers under one of the application's declared OS handlers becomes a delivery for the frame of the session that submitted it, and a declared OS action runs through the shell adapter attached for the caller. It serves link and file handlers and `open`, `reveal` and `open-file` actions. Capability plugins that require it (share target, notifications, Android intents, shortcuts) serve the other kinds through `services.os`.

Layer: plugins (`plugins/*`), shipped with the framework. Server only, except `plugin-manifest`.

## Primitives

- [Shell port](../../docs/primitives.md#shell-port): `osPlugin`, `createOsPlugin`, `openOs`, `osPluginManifest`.
- [OS handler](../../docs/primitives.md#os-handler): matching, the disabled list, per-handler rates and audit for every request; `OsConsumer` receivers for handlers whose target is a plugin.
- [OS action](../../docs/primitives.md#os-action): building and relaying declared actions, and returning page-runnable ones to the caller.
- [Host plugin](../../docs/primitives.md#host-plugin): `OsService` (`services.os.enable`, `consume`, `hold`, `relay`, `attached`, `status`) and `osServiceOf`; `OsHolder` resolvers for claim codes a capability plugin issued.

## Entrypoints

| Import                             | Runs in            | Contents                                                                         |
| ---------------------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `@agent-native/os`                 | server only        | Everything listed under Primitives.                                              |
| `@agent-native/os/plugin-manifest` | browser and server | `osPluginManifest`: the `os-scheme`, `os-link-hosts` and `os-disabled` settings. |
| `@agent-native/os/plugin`          | server only        | `osPlugin` and `createOsPlugin`.                                                 |
| `@agent-native/os/*`               | server only        | One source file: `open`, `receive`, `perform`, `declarations` or `audit`.        |

The plugin runs on the Bun host, Android and iOS. On a device the adapter attaches in-process through `connectMobileShell` in `@agent-native/mobile`, and the mobile starter passes `os-scheme` and `os-link-hosts` from its generated entry.

The scheme comes from the application identity: the desktop shell and the starter service pass `appId`'s scheme (or `app.config.json`'s `scheme`) as `os-scheme`. Without it, no scheme link matches.

## Trust boundary

A request never sets the principal, workspace or grant: it is attributed to the session that submitted it, and its delivery goes only to that session's frame. An unsolicited request only opens a resource the caller may read, navigates or prefills a form; it never commits. Handlers whose target is a consumer plugin go to that plugin's receiver, which applies its own rules, such as a single-use nonce for a reply. A `claim` request names a code a capability plugin issued for input that arrived without a session, such as a web share target post; the plugin's holder resolves it once, as the claiming session, and the request it stands for is parsed, matched and audited like any other. An unknown, used or expired code is refused as `invalid`. Each handler and each action is limited to 30 uses a minute, and a site lists ids to turn off in `os-disabled`.

Startup refuses a declared handler or action kind that no composed plugin serves, a consumer with no registered receiver, and an `os-disabled` id that names nothing, so a registration never looks served while nothing answers it.

An action is built from its declaration. Without an attached adapter, `open` and `share` instructions return to the caller to run while it has user activation; other kinds are refused as `unattached`. Every request and action is recorded on the `shell` audit channel with ids, reason codes, the platform and a digest of the raw request. Content, file names and full URLs are never logged; an open action records only the URL's origin.

`relay` runs an instruction a capability plugin built itself, such as a notification carrying the reply nonces the notifications plugin issued, through the adapter attached for the given principal. The instruction must name a declared action of the same kind that the site has not disabled, and the per-action rate applies; without an adapter it is refused as `unattached`, so the caller can keep it queued. `attached` tells whether such an adapter is there.

Reveal and open-file actions need a root directory setting, which no plugin declares yet, so they are refused.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/shell`, `@agent-native/kernel/plugin` and `/plugin-manifest`, and `@agent-native/runtime` types. Its tests also use `@agent-native/mobile` and `@agent-native/adapters`. External: `@noble/hashes` for the digest.

## Tests

```sh
bun test plugins/os
```

`test/os.test.ts` uses a fixture notes application served over HTTP. It covers the shell API answering 503 without the plugin; a link and a text file delivered to the submitting session only, with no content in the log; an unreadable resource refused when queued; refusal reasons for unknown, malformed, disabled and rate-limited requests; an open action returned to a page and relayed to an adapter that only its own session can answer; and startup refused for an unserved kind or an unknown disabled id. The [share target plugin](../share-target/README.md) uses `hold` for web share target posts, and the [notifications plugin](../notifications/README.md) uses `relay` and `attached`; their tests cover both. `test/mobile.test.ts` runs a fixture application on the mobile authority with Bun bindings for the device: a launch link held until the frame subscribes, a `content:` text file matched by media type, undeclared types never read, an unreadable resource not shown, a PDF staged in the blob store as a form's reference, an open action run through the device, and nothing attached without the plugin.

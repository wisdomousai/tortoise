# @agent-native/os

The OS [host plugin](../../docs/glossary.md#host-plugin). It provides the [shell port](../../docs/glossary.md#shell-port), which turns a request delivered under a declared [OS handler](../../docs/glossary.md#os-handler) into a delivery for the frame of the submitting session. It runs a declared [OS action](../../docs/glossary.md#os-action) through the shell adapter attached for the [caller](../../docs/glossary.md#caller).

The plugin serves link and file handlers and `open`, `reveal` and `open-file` actions. Capability plugins that require it serve the other kinds through `services.os`: share target, notifications, Android intents and shortcuts.

## Layer

Plugins (`plugins/*`), shipped with the framework. Server only, except `plugin-manifest`. The plugin takes the principal from the session that submitted a request and trusts no identity in the request itself.

The plugin runs on the Bun host, Android and iOS. On a device, the adapter attaches in-process through `connectMobileShell` in `@agent-native/mobile`. The mobile starter passes `os-scheme` and `os-link-hosts` from its generated entry.

## Primitives

- [Shell port](../../docs/primitives.md#shell-port): `osPlugin`, `createOsPlugin`, `openOs`, `osPluginManifest`.
- [OS handler](../../docs/primitives.md#os-handler): matching, the disabled list, per-handler rates and audit for every request; `OsConsumer` receivers for handlers whose target is a plugin.
- [OS action](../../docs/primitives.md#os-action): building and relaying declared actions, and returning to the caller the ones its screen can run.
- [Host plugin](../../docs/primitives.md#host-plugin): `OsService` (`services.os.enable`, `consume`, `hold`, `relay`, `attached`, `status`) and `osServiceOf`; `OsHolder` resolvers for claim codes a capability plugin issued.

## Entrypoints

| Import                             | Runs in            | Contents                                                                         |
| ---------------------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `@agent-native/os`                 | server only        | Everything listed under Primitives.                                              |
| `@agent-native/os/plugin-manifest` | browser and server | `osPluginManifest`: the `os-scheme`, `os-link-hosts` and `os-disabled` settings. |
| `@agent-native/os/plugin`          | server only        | `osPlugin` and `createOsPlugin`.                                                 |
| `@agent-native/os/*`               | server only        | One source file: `open`, `receive`, `perform`, `declarations` or `audit`.        |

The scheme comes from the application identity. The desktop shell and the starter's `apps/service` pass the scheme of `appId`, or the `scheme` in `app.config.json`, as `os-scheme`. Without it, no scheme link matches.

## Trust boundary

A request never sets the principal, workspace or [grant](../../docs/glossary.md#grant). The plugin attributes it to the session that submitted it and delivers it only to that session's frame. An unsolicited request opens a resource the caller may read, navigates or prefills a form. It never commits.

Handlers whose target is a consumer plugin go to that plugin's receiver, which applies its own rules, such as a single-use nonce for a reply. A `claim` request names a code that a capability plugin issued for input without a session, such as a web share target post. The plugin's holder resolves the code once, as the claiming session. The request it stands for is then parsed, matched and audited like any other. An unknown, used or expired code is refused as `invalid`.

Each handler and each action is limited to 30 uses a minute. A site lists the IDs to turn off in `os-disabled`. Startup refuses:

- a declared handler or action kind that no composed plugin serves;
- a consumer with no registered receiver;
- an `os-disabled` ID that names nothing.

A registration therefore never looks served while nothing answers it.

The plugin builds an action from its declaration. Without an attached adapter, `open` and `share` instructions return to the caller, which runs them while it has user activation. Other kinds are refused as `unattached`.

The plugin records every request and action on the `shell` channel of the [audit log](../../docs/glossary.md#audit-log). A record holds IDs, reason codes, the platform and a digest of the raw request. Content, file names and full URLs are never logged, and an open action records only the URL's origin.

`relay` runs an instruction that a capability plugin built itself, through the adapter attached for the given principal. An example is a notification carrying the reply nonces the notifications plugin issued. The instruction must name a declared action of the same kind that the site has not disabled, and the per-action rate applies. Without an adapter, `relay` refuses it as `unattached`, so the caller can keep it queued. `attached` tells whether such an adapter is there.

Reveal and open-file actions need a root directory setting. No plugin declares one yet, so the plugin refuses them.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/shell`, `@agent-native/kernel/plugin` and `/plugin-manifest`, and `@agent-native/runtime` types. The tests also use `@agent-native/mobile` and `@agent-native/adapters`.

External: `@noble/hashes` for the digest.

## Tests

```sh
bun test plugins/os
```

`test/os.test.ts` serves a fixture notes application over HTTP and covers:

- the shell API answering 503 without the plugin;
- a link and a text file delivered to the submitting session only, with no content in the log;
- an unreadable resource refused when queued;
- refusal reasons for unknown, malformed, disabled and rate-limited requests;
- an open action returned to a screen, and relayed to an adapter that only its own session can answer;
- a link landing as the only cross-site request served, and only as a top-level page;
- startup refused for an unserved kind or an unknown disabled ID.

`test/mobile.test.ts` runs a fixture application on the mobile instance with Bun bindings for the device. It covers:

- a launch link held until the frame subscribes;
- a `content:` text file matched by media type, with undeclared types never read;
- an unreadable resource not shown;
- a PDF staged in the blob store as a form's reference;
- an open action run through the device, and nothing attached without the plugin.

The [share target plugin](../share-target/README.md) uses `hold` for web share target posts, and the [notifications plugin](../notifications/README.md) uses `relay` and `attached`. Their tests cover both.

## Skills

- [add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md): OS handlers, actions and native registrations.

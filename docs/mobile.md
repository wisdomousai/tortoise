# Mobile host

The mobile host runs an [application](glossary.md#application) on Android and iOS phones and tablets. It stores the [workspace](glossary.md#workspace) on the device. A workspace is the application's records.

The host opens and closes the [instance](glossary.md#instance). An instance is the application opened on that workspace. The host pairs the phone or tablet with a [hub](glossary.md#hub). The application's files stay inside the app sandbox.

## Concepts

Terms: the [hub](glossary.md#hub), the [device link](glossary.md#device-link) and the paired [device](glossary.md#device).

## Packages

The Expo project in `apps/mobile` runs one application on Android and iOS. The application, its plugins and its screens come from `app.config.json` through a generated entry, so the starter names no content. The mobile host consists of:

- [`packages/mobile`](../packages/mobile/README.md): the platform, the instance and writing a native plugin.
- [`packages/frame-native`](../packages/frame-native/README.md): the native frame and the glove-sized components.
- [`apps/mobile`](../apps/mobile/README.md): the Expo project, `mobile:prepare` and the build scripts.
- [`plugins/device-link`](../plugins/device-link/README.md) and [`plugins/hub-link`](../plugins/hub-link/README.md): the hub and device sides of pairing.

## Host platform and storage

The mobile [host platform](glossary.md#host-platform) runs the same composition and runtime as the desktop host. It keeps secrets in the Keychain or Keystore, and the app lifecycle takes the place of a host process. It declares no capabilities: no raw sockets, no inbound listener and no child processes. A deployment that needs one refuses to start.

A workspace on a device is a name, not a path, so a configured value cannot address files outside the app sandbox. The snapshot [storage](glossary.md#storage) adapter keeps the workspace as one JSON document in `<name>.workspace.sqlite`. Blobs sit under `agent-native/<name>/blobs` in the document directory. Ownership is an exclusive transaction on `<name>.lock.sqlite`, held while the instance is open. A second open is refused, so two processes cannot write the same SQLite file (`packages/mobile/src/platform.ts`).

## Instance lifecycle

The instance runs on the device with its own workspace and works offline. The screens call it in-process through the direct transport, as the device's [owner](glossary.md#owner). There is no listener and no session.

The delivery and inbound sync loops and the plugin and application observers follow the app state (`packages/mobile/src/instance.ts`):

- **Foreground** starts them, so a plugin's start hook runs once per foreground ([lifecycle](architecture.md#lifecycle)).
- **Background** stops them.
- **A background pass** runs one delivery pass, bounded at 20 seconds by default, and one sync pass.
- **Close** stops everything and releases the workspace.

The screens and the background task share one instance through `apps/mobile/src/app.tsx`, because ownership refuses a second. The OS may start the runtime only to run the task. `expo-background-task` runs the pass when the OS allows it, at most every 15 minutes by default. iOS runs it rarely, so delivery there is effectively a foreground job. Records wait in the outbox meanwhile, with `offline: 'queue'` destinations.

## Embedded and attached modes

**Embedded.** Work for another system goes through the [outbox](glossary.md#outbox) as on the desktop. For a hub, that is the peer [connector](glossary.md#connector) `createPeerPort` over the hub-link network port. The hub's feed comes back through [inbound sync](glossary.md#inbound-sync).

**Attached.** A tablet paired as `attached` opens the hub's own web build in a WebView, from hub-link's Hub screens tab. Nothing is bundled, so the screens always match the hub's version. The hub's screens can declare a `compact` variant for narrow viewports, as the asset-survey review queue does.

Each side owns its workspace and is its only writer. There is no multi-master synchronization. A phone hands records to the hub, and the hub decides on each one again as `device:<id>`.

## Pairing

1. The hub issues a one-use enrollment code (`link.enrollment.create`, on the device-link screen).
2. The device exchanges the code for a credential at the hub's enrollment route. A person enters the code on the pairing screen, or device management supplies the `hub-url` and `enrollment-code` settings through [managed-config](../plugins/managed-config/README.md).
3. The device sends the credential on every request. The hub stores only digests and resolves the credential per request. It refuses a revoked device on its next request.

A `field-sync` device acts as `device:<id>`, within the capabilities the application grants it. An `attached` tablet acts as the person who enrolled it, narrowed to the capabilities chosen at enrollment.

Over the LAN, the hub listens with TLS under a deployment policy whose [hardening profile](glossary.md#hardening-profile) allows it (`site-hub`, `sandbox`). The device must trust the site CA, which device management installs. An emulator reaches a development hub on loopback through `adb reverse`.

## Trust boundary

- **No egress guard.** The plugin that provides the network port holds the platform's `fetch` and is the only network path. Hub-link reaches only the paired origin and refuses redirects. This is a weaker control than the desktop's [egress guard](glossary.md#egress-guard) and the site firewall rules.
- **The owner.** The person holding the unlocked device is the owner. The app sandbox is the only isolation between apps.
- **The device credential** is kept in secure storage, readable after first unlock and not restored onto another device.
- **The WebView** in attached mode loads only the hub origin and opens no new windows. It has no script bridge and no file access, and keeps cookies in a private store. The device credential never enters it; the WebView gets a one-use launch key and a session of its own.
- **Native plugins** are ordinary host plugins with an Expo module. A build that lacks a composed plugin's module refuses startup. A plugin composed into a platform it does not support is refused when the manifest is defined.

## Build and checks

Write the generated entry, run `expo prebuild` and start Metro for a development build:

```sh
bun run mobile:prepare
bun run mobile:prebuild
bun run dev:mobile
```

`bun run check` covers:

- the portable-source boundary;
- the platform on Bun's SQLite and files;
- `test:portable`, which runs the suites with the Web globals Hermes lacks removed;
- the native type check (`tsconfig.native.json`);
- the hub-and-phone tests in device-link and asset-survey-field.

`bun run check:mobile-bundle` bundles the starter's fixture with Metro. Device, emulator and simulator runs are on demand.

## References

- [Hosting](hosting.md#fleet)
- [Security and compliance](security-and-compliance.md#hardening-profiles)
- [Architecture](architecture.md#embedded-and-attached-modes)
- [`showcase/examples/asset-survey-field`](../showcase/examples/asset-survey-field/README.md)
- [Implementation status](implementation-status.md#mobile)
- [extend-mobile-host](../packages/mobile/skills/extend-mobile-host/SKILL.md)

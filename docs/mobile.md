# Mobile host

An Expo app in `apps/mobile` runs one application on Android and iOS. It runs the same kernel and runtime as the desktop host, on a different [host platform](primitives.md#host-platform): the device's SQLite, blobs in the app's documents, the Keychain or Keystore for secrets, and the app lifecycle in place of a service process. The application, its plugins and its screens come from `app.config.json` through a generated entry, so the starter names no content.

Package details are in the READMEs:
- [`packages/mobile`](../packages/mobile/README.md): the platform, the authority and writing a native plugin.
- [`packages/frame-native`](../packages/frame-native/README.md): the native frame and the glove-sized components.
- [`apps/mobile`](../apps/mobile/README.md): the Expo project, `mobile:prepare` and the build scripts.
- [`plugins/device-link`](../plugins/device-link/README.md) and [`plugins/hub-link`](../plugins/hub-link/README.md): the hub and device sides of pairing.

## Modes

**Embedded.** The application's authority runs in the app with its own workspace, and works offline. The screens call it in-process through the direct transport, as the device's owner. There is no listener and no session. Work for another system goes through the outbox as on the desktop. For a hub, that is the peer [connector](primitives.md#connector) `createPeerPort` over the hub-link network port. The hub's feed comes back through [inbound sync](primitives.md#inbound-sync). [`examples/asset-survey-field`](../examples/asset-survey-field/README.md) is the reference.

**Attached.** A tablet paired as `attached` opens the hub's own web build in a WebView, from hub-link's Hub screens tab. Nothing is bundled, so the screens always match the hub's version. The hub's screens can declare a `compact` variant for narrow viewports, as the asset-survey review queue does.

Each side owns its workspace and is its only writer. There is no multi-master synchronization: a phone hands records to the hub, and the hub decides on each one again as `device:<id>`.

## Pairing

1. The hub issues a one-use enrollment code (`link.enrollment.create`, on the device-link screen).
2. The device exchanges it for a credential at the hub's enrollment route. It gets the code either from a person on the pairing screen, or from device management through the `hub-url` and `enrollment-code` settings, which [managed-config](../plugins/managed-config/README.md) supplies.
3. The device then sends the credential on every request. The hub stores only digests, resolves the credential per request, and refuses a revoked device on its next request.

A `field-sync` device acts as `device:<id>`, within the operations the application grants it. An `attached` tablet acts as the person who enrolled it, narrowed to the operations chosen at enrollment.

Over the LAN, the hub listens with TLS under a site policy whose profile allows it (`site-hub`, `sandbox`). The device must trust the site CA, which device management installs. An emulator reaches a development hub on loopback through `adb reverse`.

## Background work

Integration loops run while the app is in the foreground. In the background, `expo-background-task` runs one bounded delivery and sync pass when the OS allows it. iOS runs it rarely, so delivery there is effectively a foreground job. Records wait in the outbox meanwhile, with `offline: 'queue'` destinations.

## Trust boundary

- **No egress guard.** The mobile platform declares no capabilities: no raw sockets, no inbound listener, no child processes. A deployment that needs one refuses to start. There is no in-process egress guard on the device. The plugin that provides the network port holds the platform's `fetch` and is the only network path. Hub-link reaches only the paired origin, with redirects refused. This is a weaker control than the desktop's guard and the site firewall rules.
- **The owner.** The person holding the unlocked device is the owner. The app sandbox is the only isolation between apps.
- **The device credential** is kept in secure storage, readable after first unlock and not restored onto another device.
- **The WebView** in attached mode loads only the hub origin and opens no new windows. It has no script bridge and no file access, and keeps cookies in a private store. The device credential never enters it: the page gets a one-use launch key and its own session.
- **Native plugins** are ordinary host plugins with an Expo module. A build that lacks a composed plugin's module refuses startup. A plugin composed into a platform it does not support is refused when the manifest is defined.

## Checks

`bun run check` covers:
- the portable-source boundary;
- the platform on Bun's SQLite and files;
- `test:portable`, which runs the suites with the Web globals Hermes lacks removed;
- the native type check (`tsconfig.native.json`);
- the hub-and-phone tests in device-link and asset-survey-field.

`bun run check:mobile-bundle` bundles the starter's fixture with Metro. Device, emulator and simulator runs are on demand. What has run is recorded in the [implementation status](implementation-status.md#mobile).

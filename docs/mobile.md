# Mobile host

The mobile host runs an application on an Android or iOS phone or tablet and stores its workspace on the device. Screens call the instance in the same process. The host pairs the device with a hub, and application files stay inside the app sandbox.

## Packages

The Expo project in `apps/mobile` runs one application on Android and iOS. Application, plugins and screens come from `app.config.json` through a generated entry, so the starter names no content.

- [`packages/mobile`](../packages/mobile/README.md) — the platform, the instance and writing a native plugin
- [`packages/frame-native`](../packages/frame-native/README.md) — the native frame and the glove-sized components
- [`apps/mobile`](../apps/mobile/README.md) — the Expo project, `mobile:prepare` and the build scripts
- [`plugins/device-link`](../plugins/device-link/README.md) and [`plugins/hub-link`](../plugins/hub-link/README.md) — the hub and device sides of pairing

## Host platform and storage

The mobile host platform runs the same composition and runtime as the desktop host. Secrets go in the Keychain or Keystore, and the app lifecycle takes the place of a host process. No raw sockets, no inbound listener and no child processes. A deployment that needs one refuses to start.

A workspace on a device is a name, not a path, so a configured value cannot address files outside the app sandbox. The snapshot storage adapter keeps the workspace as one JSON document in `<name>.workspace.sqlite`. Blobs sit under `tortoise/<name>/blobs` in the document directory. An exclusive transaction on `<name>.lock.sqlite` holds ownership while the instance is open. The platform refuses a second open (`packages/mobile/src/platform.ts`).

## Instance lifecycle

The instance runs on the device with its own workspace and works offline. Screens call it in-process through the direct transport, as the device's owner. No listener and no session.

Delivery, inbound sync, and plugin and application observers follow the app state (`packages/mobile/src/instance.ts`):

- **Foreground** — starts them, so a plugin's start hook runs once per foreground
- **Background** — stops them
- **A background pass** — runs one delivery pass (bounded at 20 seconds by default) and one sync pass
- **Close** — stops everything and releases the workspace

Screens and the background task share one instance through `apps/mobile/src/app.tsx`, because ownership refuses a second. The OS may start the runtime only to run the task. `expo-background-task` runs the pass when the OS allows it, at most every 15 minutes by default. iOS runs it rarely, so delivery is effectively a foreground job there. Records wait in the outbox meanwhile, with `offline: 'queue'` destinations.

## Embedded and attached modes

**Embedded.** Work for another system goes through the outbox, as on the desktop. For a hub, the peer connector `createPeerPort` sends over the hub-link network port. The hub's feed comes back through inbound sync.

**Attached.** A tablet paired as `attached` opens the hub's web build in a WebView, from hub-link's Hub screens tab. The tablet bundles nothing, so screens always match the hub's version. The hub's screens declare a `compact` variant for narrow viewports, as the asset-survey review queue does.

Each side owns its workspace and is its only writer; nothing synchronizes two writers. A phone hands records to the hub, and the hub decides on each one again as `device:<id>`.

## Pairing

1. The hub issues a one-use enrollment code (`link.enrollment.create`, on the device-link screen).
2. The device exchanges the code for a credential at the hub's enrollment route. A person enters the code on the pairing screen, or device management supplies `hub-url` and `enrollment-code` through [managed-config](../plugins/managed-config/README.md).
3. The device sends the credential on every request. The hub stores only digests and resolves the credential per request, refusing a revoked device on its next request.

A `field-sync` device acts as `device:<id>`, within the capabilities the application grants it. An `attached` tablet acts as the person who enrolled it, narrowed to the capabilities chosen at enrollment.

Over the LAN, the hub listens with TLS under a hardening profile that allows it (`site-hub`, `sandbox`). The device must trust the site CA, which device management installs. An emulator reaches a development hub on loopback through `adb reverse`.

## Trust boundary

- **No egress guard.** The plugin providing the network port holds the platform's `fetch` and is the only network path. Hub-link reaches only the paired origin and refuses redirects — weaker than the desktop's egress guard and the site firewall rules.
- **The owner.** Whoever holds the unlocked device is the owner. The app sandbox is the only isolation between apps.
- **The device credential** lives in secure storage, readable after first unlock, and never moves to another device through a backup.
- **The WebView** in attached mode loads only the hub origin and opens no new windows. No script bridge, no file access, cookies in a private store. The device credential never enters it — the WebView gets a one-use launch key and its own session.
- **Native plugins** are ordinary host plugins with an Expo module. A build missing a composed plugin's module refuses startup. `defineManifest` refuses a plugin on a platform it does not support.

## Build and checks

Write the generated entry, run `expo prebuild` and start Metro for a development build:

```sh
bun run mobile:prepare
bun run mobile:prebuild
bun run dev:mobile
```

`bun run check` covers:

- the portable-source boundary
- the platform on Bun's SQLite and files
- `test:portable`, which runs the suites with the Web globals Hermes lacks removed
- the native type check (`tsconfig.native.json`)
- the hub-and-phone tests in device-link and asset-survey-field

`bun run check:mobile-bundle` bundles the starter's fixture with Metro. Device, emulator and simulator runs are on demand.

## References

- [Hosting](hosting.md#fleet)
- [Security and compliance](security-and-compliance.md#hardening-profiles)
- [Architecture](architecture.md#embedded-and-attached-modes)
- [`showcase/examples/asset-survey-field`](../showcase/examples/asset-survey-field/README.md)
- [Implementation status](implementation-status.md#mobile)
- [extend-mobile-host](../packages/mobile/skills/extend-mobile-host/SKILL.md)

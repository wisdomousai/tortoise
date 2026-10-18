# @agent-native/hub-link

The device side of [device link](../../docs/glossary.md#device-link), which pairs a phone or tablet with a [hub](../../docs/glossary.md#hub). The plugin exchanges an enrollment code for the device's credential and keeps the credential in the platform's secret store. It provides the device's network port: one [destination](../../docs/glossary.md#destination), `hub`, at the paired origin, with the credential on every request. The hub side is [`@agent-native/device-link`](../device-link/README.md).

## Layer

Plugins (`plugins/*`). Runs on Android, iOS and Bun; `src/` is portable source.

## Primitives

- [Device link](../../docs/primitives.md#device-link): pairing, the stored credential and the `hub.pairing.*` [capabilities](../../docs/glossary.md#capability).
- [Host plugin](../../docs/primitives.md#host-plugin): `createHubLinkPlugin`, `hubLinkPlugin`, `hubLinkPluginManifest`, `hubDestinationComponent` and `hubLinkServiceOf`. The plugin provides the network port and needs the platform's secret store.
- [Connector](../../docs/primitives.md#connector): `hubNetworkPort` and `hubOrigin` carry the peer [connector](../../docs/glossary.md#connector) (`createPeerPort` in `@agent-native/integration`) to the hub.
- [Native frame](../../docs/primitives.md#native-frame): `hubLinkNativeScreens`, the pairing [screen](../../docs/glossary.md#screen) at `/hub`.

## Entrypoints

| Import                                         | Runs in               | Contents                                                                                                                        |
| ---------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/hub-link/contracts`             | browser and any host  | `hubLinkOperations`, `hubLinkModule`, `pairingSchema`, `enrollPath`.                                                            |
| `@agent-native/hub-link/plugin-manifest`       | browser and any host  | `hubLinkPluginManifest` with settings `hub-url` and `enrollment-code`; `hubDestinationComponent`.                               |
| `@agent-native/hub-link/plugin`                | any host              | `createHubLinkPlugin({ fetch?, now? })`, `hubLinkPlugin`, `hubLinkServiceOf(services)`, types `HubLinkService` and `Pairing`.   |
| `@agent-native/hub-link/network`               | any host              | `hubNetworkPort(current, fetch)`, `hubOrigin(value)`, type `Link`.                                                              |
| `@agent-native/hub-link/pairing`               | any host              | `createPairing({ secrets, fetch, now })`, the service behind the plugin.                                                        |
| `@agent-native/hub-link/plugin-screens-native` | React Native (Hermes) | `hubLinkNativeScreens`: pairing status, pair by address and code, hold to unpair; the hub's own screens for an attached tablet. |

### Pairing

The application names the outbox [target](../../docs/glossary.md#target) `hub` for [effects](../../docs/glossary.md#effect) meant for the hub. The destination component declares it with `offline: 'queue'`, so records queue while the device is unpaired or offline.

Device management can set `hub-url` and `enrollment-code` (environment `AGENT_NATIVE_HUB_URL` and `AGENT_NATIVE_ENROLLMENT_CODE`). When both are set and the device is not paired, the plugin pairs in the background once the [instance](../../docs/glossary.md#instance) is ready. A failure is recorded as the pairing error, and startup continues. Otherwise a person pairs on the screen, which calls the service through the native frame's [plugin services](../../docs/glossary.md#plugin-service).

`enrollPath` repeats the hub's route because this plugin never imports `device-link`. The device-link tests check that the two agree.

### Attached tablets

A tablet paired as `attached` opens the hub's own web build on the Hub screens tab. The screens therefore always match the hub's version, and nothing is bundled. Each time the tab mounts, the service's `launch()` asks the hub for a one-use launch key with the device credential. It then loads `<hub>/#launch=<key>`, and the hub's web build exchanges the key for a session cookie of its own. A device paired as `field-sync` sees a notice instead.

## Trust boundary

The credential is stored under `device-token` in the platform's secret store, scoped by the [kernel](../../docs/glossary.md#composition) to this plugin and workspace. On a phone that store is the Keychain or Keystore through `expo-secure-store`, readable after first unlock and not migrated to another device. The credential is stored before the pairing is recorded, so a recorded pairing always has its credential. Unpairing deletes the credential first.

The network port reaches only `hub`, and every other destination is unavailable on the device. The port enforces these rules:

- a request is refused unless its URL has the paired origin;
- redirects are errors;
- the `Authorization` header is always replaced with the device's own;
- `hubOrigin` accepts `https`, and `http` on loopback only, so an emulator reaches a development hub through `adb reverse`.

The hub's certificate must chain to a CA the device trusts. On a managed device, device management installs the site CA. The plugin holds the platform's `fetch`, which `check:boundaries` lists as a reviewed exemption. A device has no [egress guard](../../docs/glossary.md#egress-guard), and this port is its only network path.

A pairing record holds the hub origin, device ID, label and kind. Anyone holding the unlocked device is its owner.

The hub screens run in a `react-native-webview` that trusts only the hub. The credential never enters it. The web build gets a launch key, and the hub's browser [session](../../docs/glossary.md#session) rechecks the device credential on every request. Revoking the tablet on the hub therefore ends the WebView's session. The WebView is restricted as follows:

- a load off the hub origin is refused in every frame instead of being handed to the system browser (`hubPageAllows`);
- new windows are not opened;
- there is no script bridge, injected script or message handler;
- file access and mixed content are off;
- cookies live in a private store that is not shared with the application;
- a camera request from the hub's screens prompts each time on iOS, and goes through the application's camera permission on Android.

The tablet acts as the person who enrolled it, so a shared tablet has no per-person identity.

## Dependencies

- Framework:
  - `@agent-native/contracts` and `@agent-native/runtime`;
  - `@agent-native/kernel`: `plugin`, `plugin-manifest`, `application`, `instance` and `platform`;
  - `@agent-native/frame-native`, for the screens.
- External: `zod`; for the screens, `react`, `react-native`, `react-native-webview`, `@tanstack/react-query` and `lucide-react-native`.
- The secret store comes from the platform, which is `@agent-native/mobile/expo` on a device.

## Tests

```sh
bun test plugins/hub-link
```

- `test/network.test.ts` checks that a hub is reached over https or loopback http only. The credential goes only to the paired origin, redirects are refused, and every other destination is unavailable.
- `test/scenarios.test.ts` records an error, a pairing and an unpairing through `directDriver`, and denies anyone but the holder.
- `test/ui-bindings.test.ts` checks the pairing screen.
- `test/attached.test.ts` checks the launch request and the origin check.

The tests in `plugins/device-link/test` run pairing end to end against a real hub, with delivery and revocation. The `link.test.ts` file there also runs the launch exchange, the browser session's capabilities and their revocation. The WebView has not run on a device. The pairing screen has been type-checked, not rendered on a device.

## Skills

- [extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md): native plugins, native screens and pairing.

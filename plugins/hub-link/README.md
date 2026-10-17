# @agent-native/hub-link

The device side of pairing with a hub. It exchanges an enrollment code for the device's credential, keeps the credential in the platform's secret store, and provides the device's network port: one destination, `hub`, at the paired origin, with the credential on every request. The hub side is [`@agent-native/device-link`](../device-link/README.md).

Layer: plugins (`plugins/*`). Runs on Android, iOS and Bun; `src/` is portable source.

## Primitives

- [Device link](../../docs/primitives.md#device-link): pairing, the stored credential and the `hub.pairing.*` operations.
- [Host plugin](../../docs/primitives.md#host-plugin): `createHubLinkPlugin`, `hubLinkPlugin`, `hubLinkPluginManifest`, `hubDestinationComponent`, `hubLinkServiceOf`; it provides the network port and needs the platform's secret store.
- [Connector](../../docs/primitives.md#connector): `hubNetworkPort` and `hubOrigin` carry the peer connector (`createPeerPort` in `@agent-native/integration`) to the hub.
- [Native frame](../../docs/primitives.md#native-frame): `hubLinkNativeScreens`, the pairing screen at `/hub`.

## Entrypoints

| Import                                         | Runs in               | Contents                                                                                                                      |
| ---------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/hub-link/contracts`             | browser and any host  | `hubLinkOperations`, `hubLinkModule`, `pairingSchema`, `enrollPath`.                                                          |
| `@agent-native/hub-link/plugin-manifest`       | browser and any host  | `hubLinkPluginManifest` with settings `hub-url` and `enrollment-code`; `hubDestinationComponent`.                             |
| `@agent-native/hub-link/plugin`                | any host              | `createHubLinkPlugin({ fetch?, now? })`, `hubLinkPlugin`, `hubLinkServiceOf(services)`, types `HubLinkService` and `Pairing`. |
| `@agent-native/hub-link/network`               | any host              | `hubNetworkPort(current, fetch)`, `hubOrigin(value)`, type `Link`.                                                            |
| `@agent-native/hub-link/pairing`               | any host              | `createPairing({ secrets, fetch, now })`, the service behind the plugin.                                                      |
| `@agent-native/hub-link/plugin-screens-native` | React Native (Hermes) | `hubLinkNativeScreens`: pairing status, pair by address and code, hold to unpair.                                             |

The application names the outbox target `hub` for effects meant for the hub; the destination component declares it with `offline: 'queue'`, so records queue while the device is unpaired or offline. When `hub-url` and `enrollment-code` are both set (device management, environment `AGENT_NATIVE_HUB_URL` and `AGENT_NATIVE_ENROLLMENT_CODE`) and the device is not paired, the plugin pairs in the background once the runtime is ready; a failure is recorded as the pairing error and startup continues. Otherwise a person pairs on the screen, which calls the service through the native frame's plugin services. `enrollPath` repeats the hub's route because this plugin never imports `device-link`; the device-link tests check that the two agree.

## Trust boundary

The credential is stored under `device-token` in the platform's secret store, scoped by the kernel to this plugin and workspace; on a phone that is the Keychain or Keystore through `expo-secure-store`, readable after first unlock and not migrated to another device. It is stored before the pairing is recorded, so a recorded pairing always has its credential. Unpairing deletes it first.

The network port reaches only `hub`; every other destination is unavailable on the device. A request is refused unless its URL has the paired origin, redirects are errors, and the `Authorization` header is always replaced with the device's own. `hubOrigin` accepts `https` and `http` on loopback only (an emulator reaches a development hub through `adb reverse`). The hub's certificate must chain to a CA the device trusts; on a managed device, device management installs the site CA. The plugin holds the platform's `fetch`, which `check:boundaries` lists as a reviewed exemption: on a device there is no egress guard, and this port is the only network path.

A pairing record holds the hub origin, device id, label and kind; anyone holding the unlocked device is its owner.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/kernel` (`plugin`, `plugin-manifest`, `application`, `authority`, `platform`), `@agent-native/runtime`, `@agent-native/frame-native` (screens). External: `zod`; for the screens `react`, `react-native`, `@tanstack/react-query`, `lucide-react-native`. The secret store comes from the platform (`@agent-native/mobile/expo` on a device).

## Tests

```sh
bun test plugins/hub-link
```

`test/network.test.ts` checks that a hub is reached over https or loopback http only, that the credential goes only to the paired origin with redirects refused, and that every other destination is unavailable. `test/scenarios.test.ts` records an error, a pairing and an unpairing through the direct driver and denies anyone but the holder. `test/ui-bindings.test.ts` checks the pairing screen. Pairing end to end, delivery and revocation are tested with a real hub in `plugins/device-link/test`. The screen has been type-checked, not rendered on a device.

# @agent-native/device-link

The hub side of pairing phones and tablets. An administrator creates a one-use enrollment code on the hub; a device exchanges it at the enrollment route for its own bearer credential and presents that on every later request. The device side is [`@agent-native/hub-link`](../hub-link/README.md).

Layer: plugins (`plugins/*`). Bun only: a hub is a serving host.

## Primitives

- [Device link](../../docs/primitives.md#device-link): the `link.*` operations, the enrollment route and credential resolution.
- [Host plugin](../../docs/primitives.md#host-plugin): `createDeviceLinkPlugin`, `deviceLinkPlugin`, `deviceLinkPluginManifest`; it uses the public-route and credential hooks of a serving host.
- [Capability binding](../../docs/primitives.md#capability-binding): `deviceLinkScreens`, the devices screen at `/devices`.

## Entrypoints

| Import                                      | Runs in              | Contents                                                                                                     |
| ------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `@agent-native/device-link/contracts`       | browser and any host | `deviceLinkOperations`, `deviceLinkModule`, `enrollPath`, `deviceKinds`, `deviceSchema`, `enrollmentSchema`. |
| `@agent-native/device-link/plugin-manifest` | browser and any host | `deviceLinkPluginManifest`, with the setting `device-link-sync-operations`.                                  |
| `@agent-native/device-link/plugin`          | Bun host             | `createDeviceLinkPlugin({ now?, syncOperations? })` and `deviceLinkPlugin`, for `defineApplication({ plugins })`. |
| `@agent-native/device-link/plugin-screens`  | browser              | `deviceLinkScreens`: device list, enrollment code, rename and revoke.                                        |

Two kinds of device:

- `field-sync`, a phone that keeps its own workspace. It acts as principal `device:<id>` with a grant of the operations in `device-link-sync-operations` (comma-separated; environment `AGENT_NATIVE_DEVICE_LINK_SYNC_OPERATIONS`). An application that knows its field operations passes them as the default with `createDeviceLinkPlugin({ syncOperations })`; the setting still overrides it. The application's policy decides what `device:*` principals may do within that grant. Startup fails when the setting names an operation the catalog lacks.
- `attached`, a tablet that shows the hub's screens. It acts as the person who created the code, with a grant of the operations chosen at enrollment, or every operation except `link.*` when none were chosen.

`POST /api/v1/link/enroll` with `{ "code": "..." }` answers `201 { token, device: { id, label, kind } }` with `Cache-Control: no-store`. Codes are ten characters from an alphabet without look-alike letters, accepted without case or separators, valid for ten minutes, and pruned from state a day after they expire or are used. The token is 32 random bytes in base64url. Failed exchanges are limited to ten per minute for all callers together; after that the route answers `UNAVAILABLE` until the window passes.

## Trust boundary

The enrollment route runs before the session check, so it is reachable by anyone who reaches the listener. It only redeems a code, through the runtime, as the local owner narrowed to the redeem and resolve operations; the plugin gets that context when the host starts listening, and before then the route answers `UNAVAILABLE`. One message covers an unknown, expired and used code.

The hub stores SHA-256 digests of codes and tokens, never the values. The redeemed code stays in the redeem command's stored receipt, which is harmless once used; the audit log records none of the redeem input. A token is resolved through `link.credential.resolve` on every request, so revocation applies to the next request and a revoked or unknown token is refused as a credential (`FORBIDDEN` with `details.credential`), which a client tells apart from a denied operation. The resolved context does not pass through the identity port's admission; the site policy decides whether a network listener exists at all, and only the `site-hub` and `sandbox` profiles allow TLS without client certificates.

Only the plugin's admins (the owner who created the workspace) create codes, list, rename and revoke devices. A tablet cannot create codes or manage devices, because `link.*` is never in its grant.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/kernel` (`plugin`, `plugin-manifest`, `application`), `@agent-native/runtime`, `@agent-native/adapters` (`http` for the JSON helpers), `@agent-native/frame` (screens). External: `@noble/hashes`, `zod`, `react`, `@tanstack/react-query`, `lucide-react`. The tests also compose `@agent-native/hub-link`, `@agent-native/mobile`, `@agent-native/host`, `@agent-native/site`, `@agent-native/network` and `@agent-native/audit`.

## Tests

```sh
bun test plugins/device-link
```

- `test/link.test.ts` runs a hub with `startHost` on loopback and a field app on the mobile platform with Bun's SQLite and files, paired through `@agent-native/hub-link`. A capture taken before pairing waits with the reason; a wrong code is shown on the device; after pairing, a lost response is replayed without a second capture on the hub; the photo arrives before the record; an offline capture goes once the network returns; a hub rejection reaches the device with its code; assignments come back through the feed. A phone can call only the sync operations, a revoked phone is refused as a credential and its records stay pending until it pairs again, a tablet works within its chosen operations, and codes are single-use, expire and are throttled.
- `test/tls.test.ts` (skipped without `openssl`) starts the hub under a `site-hub` policy with a TLS listener and a throwaway site CA: a client without the CA fails the handshake, and a phone that trusts it pairs and delivers.
- `test/scenarios.test.ts` runs the `link.*` operations through the direct driver; `test/ui-bindings.test.ts` checks that the devices screen references every bound operation.

## Skills

- [extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md): native plugins, native screens and pairing.

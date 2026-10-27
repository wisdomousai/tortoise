# @agent-native/device-link

The hub side of [device link](../../docs/glossary.md#device-link), which pairs phones and tablets with a [hub](../../docs/glossary.md#hub). An administrator creates a one-use enrollment code on the hub. A device exchanges the code at the enrollment route for its own bearer credential and presents that credential on every later request. The device side is [`@agent-native/hub-link`](../hub-link/README.md).

## Layer

Plugins (`plugins/*`). Bun only, because a hub is a serving [host](../../docs/glossary.md#host).

## Primitives

- [Device link](../../docs/primitives.md#device-link): the `link.*` [capabilities](../../docs/glossary.md#capability), the enrollment route and credential resolution.
- [Host plugin](../../docs/primitives.md#host-plugin): `createDeviceLinkPlugin`, `deviceLinkPlugin` and `deviceLinkPluginManifest`. The plugin uses the public-route and credential hooks of a serving host. Its manifest keeps the operation namespace `link`, because the operation IDs are the device protocol.
- [Capability binding](../../docs/primitives.md#capability-binding): `deviceLinkScreens`, the devices [screen](../../docs/glossary.md#screen) at `/devices`.

## Entrypoints

| Import                                      | Runs in              | Contents                                                                                                     |
| ------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `@agent-native/device-link/contracts`       | browser and any host | `deviceLinkOperations`, `deviceLinkModule`, `enrollPath`, `deviceKinds`, `deviceSchema`, `enrollmentSchema`. |
| `@agent-native/device-link/plugin-manifest` | browser and any host | `deviceLinkPluginManifest`, with the setting `device-link-sync-operations`.                                  |
| `@agent-native/device-link/plugin`          | Bun host             | `createDeviceLinkPlugin({ now?, syncOperations? })` and `deviceLinkPlugin`, for `defineApplication({ plugins })`. |
| `@agent-native/device-link/plugin-screens`  | browser              | `deviceLinkScreens`: device list, enrollment code, rename and revoke.                                        |

### Device kinds

- **`field-sync`**: a phone that keeps its own [workspace](../../docs/glossary.md#workspace). It acts as [principal](../../docs/glossary.md#principal) `device:<id>`, with a [grant](../../docs/glossary.md#grant) of the sync capabilities.
- **`attached`**: a tablet that shows the hub's screens. It acts as the person who created the code, with a grant of the capabilities chosen at enrollment, or of every capability except `link.*` when none were chosen.

The sync capabilities come from the `device-link-sync-operations` setting, a comma-separated list (environment `AGENT_NATIVE_DEVICE_LINK_SYNC_OPERATIONS`). An application that knows its field capabilities passes them as the default with `createDeviceLinkPlugin({ syncOperations })`. The setting still overrides that default. The application's [policy](../../docs/glossary.md#policy) decides what `device:*` principals may do within the grant. For the `assignment` feature's device assignees, the feature's policy decides instead, and it lets a device work only on what was sent to it. Startup fails when the setting names a capability the [catalog](../../docs/glossary.md#catalog) lacks.

### Enrollment route

`POST /api/v1/link/enroll` with `{ "code": "..." }` returns `201 { token, device: { id, label, kind } }` with `Cache-Control: no-store`. An enrollment code:

- is ten characters from an alphabet without look-alike letters;
- is accepted without case or separators;
- is valid for ten minutes;
- is pruned from state a day after it expires or is used.

The token is 32 random bytes in base64url. Failed exchanges are limited to ten per minute for all callers together. After that, the route returns `UNAVAILABLE` until the window passes.

## Trust boundary

The enrollment route runs before the session check, so anyone who reaches the listener can reach it. The route only redeems a code, through the [instance](../../docs/glossary.md#instance), as the local [owner](../../docs/glossary.md#owner) narrowed to the redeem and resolve capabilities. The plugin gets that context when the host starts listening, and before then the route returns `UNAVAILABLE`. One message covers an unknown, an expired and a used code.

The hub stores SHA-256 digests of codes and tokens, never the values. The redeemed code stays in the redeem command's stored [receipt](../../docs/glossary.md#receipt), which is harmless once the code is used. The [audit log](../../docs/glossary.md#audit-log) records none of the redeem input.

The hub resolves a token through `link.credential.resolve` on every request, so a revocation applies to the next request. A revoked or unknown token is refused as a credential, with `FORBIDDEN` and `details.credential`. A client can tell that refusal apart from a denied capability.

The resolved context does not pass through the identity port's admission. The [deployment policy](../../docs/glossary.md#deployment-policy) decides whether a network listener exists at all. Only the `site-hub` and `sandbox` [hardening profiles](../../docs/glossary.md#hardening-profile) allow TLS without client certificates.

Only the plugin's admins create codes and list, rename and revoke devices. The admins are the owner who created the workspace. A tablet cannot create codes or manage devices, because `link.*` is never in its grant.

## Dependencies

- Framework:
  - `@agent-native/contracts` and `@agent-native/runtime`;
  - `@agent-native/kernel`: `plugin`, `plugin-manifest` and `application`;
  - `@agent-native/adapters`: `http`, for the JSON helpers;
  - `@agent-native/host`: `enrollment`, for codes, credentials and the attempt limit;
  - `@agent-native/frame`, for the screens.
- External: `zod`, `react`, `@tanstack/react-query` and `lucide-react`.
- Tests also compose `@agent-native/hub-link`, `@agent-native/mobile`, `@agent-native/site`, `@agent-native/network` and `@agent-native/audit`.

## Tests

```sh
bun test plugins/device-link
```

- `test/link.test.ts` runs a hub with `startHost` on loopback and a field application on the mobile platform, with Bun's SQLite and files. The two pair through `@agent-native/hub-link`. It covers:
  - a capture taken before pairing, which waits with the reason;
  - a wrong code, which the device shows;
  - a lost response after pairing, replayed without a second capture on the hub;
  - the photo uploaded before the record;
  - an offline capture, which goes once the network returns;
  - a hub rejection, which reaches the device with its code;
  - assignments, which come back through the feed;
  - a phone that can call only the sync capabilities;
  - a revoked phone, refused as a credential, whose records stay pending until it pairs again;
  - a tablet that works within its chosen capabilities;
  - codes that are single-use, expire and are throttled.
- `test/tls.test.ts` starts the hub under a `site-hub` policy with a TLS listener and a throwaway site CA. A client without the CA fails the handshake, and a phone that trusts it pairs and delivers. The test is skipped without `openssl`.
- `test/scenarios.test.ts` runs the `link.*` [behavioral scenarios](../../docs/glossary.md#behavioral-scenario) through `directDriver`.
- `test/ui-bindings.test.ts` checks that the devices screen references every bound capability.

## Skills

- [extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md): native plugins, native screens and pairing.

## References

- [Mobile: pairing](../../docs/mobile.md#pairing)

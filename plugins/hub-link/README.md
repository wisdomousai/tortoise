# @tortoise/hub-link

The device side of pairing with a hub. It trades an enrollment code for a credential, stores it under `device-token` in the platform's secret store (on a phone the Keychain or Keystore through `expo-secure-store`, readable after first unlock and not migrated to another device), and sends it on every request to the `hub` destination. Compose `createHubLinkPlugin` from `@tortoise/hub-link/plugin` with its `plugin-manifest`; `createPeerPort` gives the outbox a connector to the hub.

Primitives:

- [Device link](../../docs/primitives.md#device-link)
- [Host plugin](../../docs/primitives.md#host-plugin)
- [Connector](../../docs/primitives.md#connector)
- [Native frame](../../docs/primitives.md#native-frame)

## References

- [extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md)
- [Mobile: pairing](../../docs/mobile.md#pairing)
- `bun test plugins/hub-link`

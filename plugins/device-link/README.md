# @tortoise/device-link

The hub side of pairing phones and tablets: an admin creates a one-use code on the hub, and the device trades it for its own credential. Compose `createDeviceLinkPlugin` from `@tortoise/device-link/plugin` with its `plugin-manifest` and `plugin-screens` entrypoints. The enrollment route runs before the session check, so anyone who reaches the listener reaches it; it only redeems a code, through the instance, as the local user narrowed to the redeem and resolve capabilities. The device side is [`@tortoise/hub-link`](../hub-link/README.md).

Primitives:

- [Device link](../../docs/primitives.md#device-link)
- [Host plugin](../../docs/primitives.md#host-plugin)
- [Capability binding](../../docs/primitives.md#capability-binding)

## References

- [Mobile: pairing](../../docs/mobile.md#pairing)
- [extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md)
- `bun test plugins/device-link`

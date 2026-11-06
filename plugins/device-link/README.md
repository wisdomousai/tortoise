# @tortoise/device-link

`@tortoise/device-link` issues credentials to enrolled devices. An authorized administrator creates a one-use enrollment code; a device redeems it through the host's enrollment route. Compose `createDeviceLinkPlugin` with its manifest and screen contributions.

The enrollment route is available before ordinary session authentication. It can only redeem and resolve the code through a narrowly scoped runtime call. The [hub-link plugin](../hub-link/README.md) implements credential use on the device.

## References

[Mobile: pairing](../../docs/mobile.md#pairing)

[extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md)

`bun test plugins/device-link`

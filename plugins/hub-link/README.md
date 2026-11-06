# @tortoise/hub-link

`@tortoise/hub-link` enrolls a device with a configured hub and attaches the resulting credential to hub requests. Compose `createHubLinkPlugin` with its manifest contribution. `createPeerPort` supplies the connector used to deliver the device's outbox.

The platform secret store keeps the credential under `device-token`. On a phone this uses `expo-secure-store` and the configured device-local accessibility policy. The hub validates the device's credential and allowed operations on each call.

## References

[extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md)

[Mobile: pairing](../../docs/mobile.md#pairing)

`bun test plugins/hub-link`

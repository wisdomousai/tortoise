# @tortoise/managed-config

`@tortoise/managed-config` reads device-management settings when the instance opens. Compose `createManagedConfigPlugin` with its manifest and add the package's Expo config plugin to the mobile host.

The platform reads Android application restrictions or iOS managed application configuration. Managed settings have launcher-level trust and override launcher values. Validation of the resolved settings still belongs to the component that consumes them.

## References

[extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md)

`bun test plugins/managed-config`

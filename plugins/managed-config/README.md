# @agent-native/managed-config

Reads settings an administrator sets through device management (Android app restrictions, iOS managed app configuration) when the instance opens. Compose `createManagedConfigPlugin` from `@agent-native/managed-config/plugin` with its `plugin-manifest`, and add `@agent-native/managed-config/app.plugin` to the Expo config. Managed values carry the trust of launcher settings and win over them, so a person cannot point a managed device at another hub.

Primitives:

- [Host plugin](../../docs/primitives.md#host-plugin)

## References

- [extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md)
- `bun test plugins/managed-config`

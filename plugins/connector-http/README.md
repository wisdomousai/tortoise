# @tortoise/connector-http

`@tortoise/connector-http` implements a system-of-record port over HTTP. The connector specification supplies the request mapping for each effect and identifies business rejection responses. It can also declare an outcome lookup and inbound change feed.

`connect` binds that specification to a destination-scoped network client. The deployment policy supplies the origin and configured credential handling. Connector code sends requests through the network port and does not read provider credentials directly.

## References

[connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md)

`bun test plugins/connector-http`

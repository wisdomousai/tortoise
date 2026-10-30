# @agent-native/connector-http

Reaches a REST system of record through the network port. You describe the system as data: the request per effect, the rejection statuses, lookup by key and the change feed; `connect` turns that into a connector. Every request goes through `network.client(destination).fetch`, so the egress guard sees it and the deployment policy supplies the address and credentials. The port never reads a credential.

Primitives:

- [Connector](../../docs/primitives.md#connector)

## References

- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md)
- `bun test plugins/connector-http`

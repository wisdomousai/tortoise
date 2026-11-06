# @tortoise/connector-opcua

`@tortoise/connector-opcua` polls declared node values through `createOpcUaObserver` and submits accepted readings through an ingest operation. The connector implements a read-only OPC UA session; application requirements name the server it may reach.

The decoder bounds assembled messages and validates reads before consuming the binary payload. Unsupported structured values are reported as unsupported. Source health and stale readings must be handled through the observation contract.

## References

[observe-plant-signals](../../packages/observation/skills/observe-plant-signals/SKILL.md)

[Implementation status: connector plugins](../../docs/implementation-status.md#connector-plugins)

`bun test plugins/connector-opcua`

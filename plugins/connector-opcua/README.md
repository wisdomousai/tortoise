# @agent-native/connector-opcua

Polls an OPC UA server's node values and submits them as observations through the app's ingest command with `createOpcUaObserver`. It never writes to the server. The decoder caps messages at 16 MB and 512 chunks, bounds-checks every read, and skips an array or structured value exactly, reporting it unsupported.

Primitives:

- [Observation](../../docs/primitives.md#observation)

## References

- [observe-plant-signals](../../packages/observation/skills/observe-plant-signals/SKILL.md)
- [Implementation status: connector plugins](../../docs/implementation-status.md#connector-plugins)
- `bun test plugins/connector-opcua`

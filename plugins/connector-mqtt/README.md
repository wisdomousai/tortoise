# @tortoise/connector-mqtt

Reads an MQTT broker (plain JSON or scalar topics, and Sparkplug B) and submits the values as observations through the app's ingest command with `createMqttObserver`. It never publishes. The decoder caps packets at 1 MB and reads protobuf fields by wire type with bounds checks, so it drops a malformed payload.

Primitives:

- [Observation](../../docs/primitives.md#observation)

## References

- [observe-plant-signals](../../packages/observation/skills/observe-plant-signals/SKILL.md)
- [Implementation status: connector plugins](../../docs/implementation-status.md#connector-plugins)
- `bun test plugins/connector-mqtt`

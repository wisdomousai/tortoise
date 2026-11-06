# @tortoise/connector-mqtt

`@tortoise/connector-mqtt` subscribes to configured MQTT readings through `createMqttObserver`. It decodes plain topics or Sparkplug B payloads and submits accepted readings through the application's ingest operation. Its protocol implementation does not publish values.

The decoder bounds packet sizes and checks protobuf wire reads before consuming a Sparkplug payload. Malformed input is discarded. The [plant-signal skill](../../packages/observation/skills/observe-plant-signals/SKILL.md) specifies source configuration and observation behavior.

## References

[observe-plant-signals](../../packages/observation/skills/observe-plant-signals/SKILL.md)

[Implementation status: connector plugins](../../docs/implementation-status.md#connector-plugins)

`bun test plugins/connector-mqtt`

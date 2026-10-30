# Monitor oil-sample conditioning

Climate chambers condition oil samples before testing. This pattern adds the chambers to the [base lab desk](../base/README.md): the desk reads each chamber's temperature through OPC UA and its humidity through Sparkplug B over MQTT, and a chamber counts as conditioned only when it has both readings within tolerance. A lost gateway, a dead edge node or a sequence gap marks the value uncertain until the source confirms it again; the observers only read. The deployment policy must bind `chamber-gateway` and `chamber-broker`, and the OPC UA client uses an anonymous session with security policy None, so a real installation needs a segmented control network.

```sh
cd showcase/patterns/signals
bun run dev:web
```

## What to try

- The launch starts fake OPC UA and MQTT endpoints on loopback ports 4374 and 4373 and the app on 4356; chamber 2's humidity leaves tolerance and returns every two minutes.
- Place a test request in a chamber and watch its condition change.
- The OPC UA observer reports a temperature only after two equal reads.

## References

- [observe-plant-signals](../../../packages/observation/skills/observe-plant-signals/SKILL.md)
- [OPC UA connector](../../../plugins/connector-opcua/README.md), [MQTT connector](../../../plugins/connector-mqtt/README.md)
- `bun test showcase/patterns/signals` runs the real observers against the fake endpoints only

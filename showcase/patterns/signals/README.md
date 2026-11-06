# Monitor oil-sample conditioning

This pattern submits plant readings through observation commands on the hypothetical [base application](../base/README.md). An OPC UA observer reads chamber temperature, and a Sparkplug B observer reads humidity. The application marks a chamber conditioned only when its required readings satisfy its configured tolerances.

The launch uses loopback protocol fixtures. Source interruption or sequence loss makes the affected reading uncertain until the source confirms it again. The configured OPC UA session uses security policy None, so the fixture's network assumptions must be reviewed before any real deployment.

```sh
cd showcase/patterns/signals
bun run dev:web
```

## What to try

The launch starts fake OPC UA and MQTT endpoints on loopback ports 4374 and 4373 and the app on 4356; chamber 2's humidity leaves tolerance and returns every two minutes.

Place a test request in a chamber and watch its condition change.

The OPC UA observer reports a temperature only after two equal reads.

## References

[observe-plant-signals](../../../packages/observation/skills/observe-plant-signals/SKILL.md)

[OPC UA connector](../../../plugins/connector-opcua/README.md), [MQTT connector](../../../plugins/connector-mqtt/README.md)

`bun test showcase/patterns/signals` runs the real observers against the fake endpoints only

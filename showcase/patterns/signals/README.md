# Monitor oil-sample conditioning

Oil samples are conditioned in climate chambers before testing. The lab desk reads chamber temperature through OPC UA and humidity through Sparkplug B over MQTT. A technician places a test request in a chamber and sees whether both readings are within the configured tolerances.

## Try the plant stand-in

From the repository root:

```sh
cd showcase/patterns/signals
bun run dev:web
```

The launch starts fake OPC UA and MQTT endpoints on loopback ports 4374 and 4373. Chamber 1 holds its setpoint; chamber 2's humidity moves outside tolerance and returns every two minutes. Place a sample in a chamber and watch its condition change.

## From readings to a condition

The OPC UA observer requires two equal temperature reads before reporting a stable value. The Sparkplug observer follows each edge node's birth, data and death messages. Both submit [observations](../../../docs/primitives.md#observation) through `chamber.reading.ingest` as `chamber-observer`; the application records a new value or marks the last value uncertain.

A chamber counts as conditioned only when temperature and humidity are both observed and within tolerance. A lost gateway, a dead edge node or a sequence gap marks the affected value uncertain until the source confirms it again. The observers only read; they do not write to the plant.

The site policy must bind `chamber-gateway` and `chamber-broker` before the observers can connect. The example's OPC UA client uses an anonymous session and security policy None, so a real installation needs a segmented control network and must account for the [connector's limits](../../../plugins/connector-opcua/README.md).

## Code and checks

[`observers.ts`](observers.ts) wires both sources; [`handlers.ts`](handlers.ts) records conditions; [`fake-plant.ts`](fake-plant.ts) supplies the demo endpoints.

```sh
bun test showcase/patterns/signals
```

The test drives the real observers against fake endpoints, including lost connections, uncertain values and refused callers. It does not verify a real broker or controller.

# @agent-native/connector-mqtt

Read-only observation of an MQTT broker: plain topics with JSON or scalar payloads, and Sparkplug B edge nodes and devices. Values become gated readings and are submitted through the application's ingest command, as the screen and driver observers do. Nothing is ever published.

Layer: plugins (`plugins/*`). `./contracts` is browser-safe data; everything else is server only. The MQTT 3.1.1 client, the protobuf reader and the Sparkplug B state are implemented here, with no client library. [Observation](../../docs/primitives.md#observation) and [Connector](../../docs/primitives.md#connector) in the primitives index.

## Wiring an application

- **Manifest:** list `mqttBroker({ id, destination, description, dataClasses })` in `components`. It declares a `site`-scoped `tcp` egress destination with offline `degrade`.
- **Site policy:** bind the destination to `tcp://broker:1883`, or with `tls: true` (and a `ca` or certificate pins) for 8883. The policy also holds the broker credentials the deployment passes in, never the code.
- **`observe`:** start `createMqttObserver({ subscriber: { network, destination, clientId, username?, password? }, fields, application, context, ingestOperation })` with an interval, and stop it on shutdown.

A field is one of:

- `{ id, sparkplug: { group, node, device?, metric } }`: a Sparkplug B metric, found by name or by its birth alias;
- `{ id, topic, pointer? }`: the latest message on one topic, parsed as JSON and read at the pointer, or taken as text or a number.

`filtersFor(fields)` is the subscription list: one Sparkplug filter per node (`spBv1.0/<group>/+/<node>/#`) and each plain topic.

## Contents

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/connector-mqtt` | server | Everything below |
| `@agent-native/connector-mqtt/contracts` | browser and server | `mqttBroker` |
| `@agent-native/connector-mqtt/client` | server | `createMqttSubscriber`: clean session, QoS 1 subscriptions, keep-alive, reconnect with backoff up to 60 s |
| `@agent-native/connector-mqtt/sparkplug` | server | `decodePayload`, `parseTopic`, `DataType` and `SparkplugState` |
| `@agent-native/connector-mqtt/observe` | server | `createMqttObserver`, `filtersFor` |
| `@agent-native/connector-mqtt/testing` | server (tests) | `FakeBroker` (a loopback broker that records connects and anything published to it), `encodeSparkplug`, `matches` |

### Sparkplug B state

- A node birth replaces the node's metrics and aliases and clears its devices; a device birth replaces that device's.
- Data updates by name or alias. Historical metrics are ignored.
- A sequence gap, a node death whose `bdSeq` matches the birth, a device death or a lost broker connection makes the affected values stale until the next birth. A death with an older `bdSeq` is ignored.
- 64-bit integers above the safe range are kept as decimal strings, so no value is rounded.

A stale value is read with confidence 0, so the gate marks it `uncertain` and the domain does not take it as fact. The observer never sends a rebirth request, because that would be a write.

## Trust boundary

The broker and its publishers are input. Packets are capped at 1 MB, and protobuf fields are read by wire type with bounds checks, so a malformed payload is dropped, not trusted. Every connection goes through the network port to the bound destination, so the egress guard audits it. The observer submits as the principal in `context`, which the policy should grant the ingest command only. Readings are claims about the source; the ingest handler decides what they change.

Limits:

- MQTT 3.1.1 only, no MQTT 5;
- read-only: no publishing, no commands to edge nodes, no rebirth requests;
- Sparkplug arrays, bytes, files, data sets, templates and property sets are not decoded: such a metric carries no value;
- a plain topic keeps only its latest message.

## Tests

```sh
bun test plugins/connector-mqtt
```

`test/connector-mqtt.test.ts` covers packet framing across chunks and the size limit, topic filters, every scalar Sparkplug type with signed and 64-bit values, births, aliases, sequence gaps, old and current deaths, historical metrics, readings and their idempotency keys, a dropped broker making readings uncertain, nothing published, and a refused connection retried.

An interop run by hand against an independent broker and publisher is recorded in the [implementation status](../../docs/implementation-status.md).

## Skills

- [observe-plant-signals](../../packages/observation/skills/observe-plant-signals/SKILL.md): declaring the source, writing the ingest command, starting the observer and binding the destination.

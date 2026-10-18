# @agent-native/connector-mqtt

This plugin observes an MQTT broker read-only: plain topics with JSON or scalar payloads, and Sparkplug B edge nodes and devices. Values become gated [observations](../../docs/glossary.md#observation), submitted through the application's ingest command as the screen and driver observers do. The plugin never publishes.

## Layer

Plugin layer, as a library without plugin entrypoints. `./contracts` is browser-safe data; everything else is server only. The MQTT 3.1.1 client, the protobuf reader and the Sparkplug B state are implemented here, with no client library. The broker and its publishers are input.

## Primitives

- [Observation](../../docs/primitives.md#observation): `createMqttObserver`, `filtersFor`, `mqttBroker`, with `createMqttSubscriber` and the Sparkplug B decoder underneath. The plugin implements no connector for a target.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/connector-mqtt` | server | Everything below except `testing`. |
| `@agent-native/connector-mqtt/contracts` | browser and server | `mqttBroker`. |
| `@agent-native/connector-mqtt/client` | server | `createMqttSubscriber`: clean session, QoS 1 subscriptions, keep-alive, reconnect with backoff up to 60 seconds. |
| `@agent-native/connector-mqtt/sparkplug` | server | `decodePayload`, `parseTopic`, `DataType` and `SparkplugState`. |
| `@agent-native/connector-mqtt/observe` | server | `createMqttObserver`, `filtersFor`. |
| `@agent-native/connector-mqtt/testing` | server (tests) | `FakeBroker`, `encodeSparkplug`, `matches`. |

`FakeBroker` is a loopback broker that records connects and anything published to it.

### Application wiring

- **Manifest:** list `mqttBroker({ id, destination, description, dataClasses })` in `components`. It declares a `site`-scoped `tcp` egress [destination](../../docs/glossary.md#destination) with offline `degrade`.
- **Deployment policy:** bind the destination to `tcp://broker:1883`, or to port 8883 with `tls: true` and a `ca` or certificate pins. The deployment passes the broker credentials in through the policy, never through the code.
- **`observe`:** start `createMqttObserver({ subscriber: { network, destination, clientId, username?, password? }, fields, application, context, ingestOperation })` with an interval, and stop it on shutdown.

A field is one of:

- `{ id, sparkplug: { group, node, device?, metric } }`: a Sparkplug B metric, found by name or by its birth alias;
- `{ id, topic, pointer? }`: the latest message on one topic, parsed as JSON and read at the pointer, or taken as text or a number.

`filtersFor(fields)` returns the subscription list: one Sparkplug filter per node (`spBv1.0/<group>/+/<node>/#`) and each plain topic.

### Sparkplug B state

- A node birth replaces the node's metrics and aliases and clears its devices. A device birth replaces that device's metrics and aliases.
- Data updates a metric by name or alias. Historical metrics are ignored.
- These make the affected values stale until the next birth: a sequence gap, a node death whose `bdSeq` matches the birth, a device death, or a lost broker connection.
- A death with an older `bdSeq` is ignored.
- 64-bit integers above the safe range are kept as decimal strings, so no value is rounded.

The observer reads a stale value with confidence 0, so the gate marks it `uncertain` and the domain does not take it as fact. The observer never sends a rebirth request, because that would be a write.

## Trust boundary

Packets are capped at 1 MB. Protobuf fields are read by wire type with bounds checks, so a malformed payload is dropped. Every connection goes through the network port to the bound destination, so the [egress guard](../../docs/glossary.md#egress-guard) audits it.

The observer submits as the principal in `context`, and the policy should grant that principal the ingest command only. Observations are claims about the source, and the ingest handler decides what they change.

Limits:

- MQTT 3.1.1 only, no MQTT 5;
- read-only: no publishing, no commands to edge nodes, no rebirth requests;
- Sparkplug arrays, bytes, files, data sets, templates and property sets are not decoded, so such a metric carries no value;
- a plain topic keeps only its latest message.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/host/plugin`, `@agent-native/kernel/plugin`, `@agent-native/observation` and `@agent-native/runtime`. No external packages.

## Tests

```sh
bun test plugins/connector-mqtt
```

`test/connector-mqtt.test.ts` covers:

- packet framing across chunks, and the size limit;
- topic filters;
- every scalar Sparkplug type, with signed and 64-bit values;
- births, aliases, sequence gaps, old and current deaths, and historical metrics;
- observations and their idempotency keys;
- a dropped broker making observations uncertain, with nothing published;
- a refused connection, retried.

The [implementation status](../../docs/implementation-status.md#connector-plugins) records an interop run by hand against an independent broker and publisher.

## Skills

- [observe-plant-signals](../../packages/observation/skills/observe-plant-signals/SKILL.md): declaring the source, writing the ingest command, starting the observer and binding the destination.

---
name: observe-plant-signals
description: Read values from plant control systems into an agent-native application as gated readings, through an MQTT broker (plain topics or Sparkplug B) or an OPC UA server. Use when a module needs machine state, counters or process values that only a broker or controller gateway has, when writing an ingest command for such readings, or when binding a broker or OPC UA server in a deployment policy. Covers packages/observation, plugins/connector-mqtt and plugins/connector-opcua.
---

# Observe plant signals

A broker or an OPC UA server is a source that can be read but not queried for history or written. Its values become readings: claims about the source, with provenance and confidence. An ingest command decides what they change.

## Before writing

- List each field: its ID, where it comes from, and how many equal reads make it stable. A field comes from one of:
  - a Sparkplug group, node, optional device and metric;
  - a plain topic and JSON pointer;
  - an OPC UA node ID such as `ns=2;s=Press.Temperature`.
- Decide what an `uncertain` reading means in the domain. A stale Sparkplug value, an uncertain or bad OPC UA status, and a lost connection all arrive as `uncertain`. Route them to a person, not to a record.
- Both connectors only read. A write to a controller is a declared procedure with readback, which these connectors do not offer. For actions on equipment, see the `write-hardware-driver` skill (`plugins/connector-driver/skills/write-hardware-driver/SKILL.md`).

## Steps

1. Declare the source in the manifest's `components` with `mqttBroker({ id, destination, description, dataClasses })` or `opcUaServer({ ... })`. Each declares a `site`-scoped `tcp` destination with offline `degrade`.
2. Write the ingest command with the `add-capability` skill (`packages/runtime/skills/add-capability/SKILL.md`). Its input is the [observation](../../../../docs/glossary.md#observation), or what `toInput` maps it to. It records stable readings and raises attention for uncertain ones.
3. Grant the ingest command, and nothing else, to the observing [principal](../../../../docs/glossary.md#principal).
4. Create the observer in `connect`'s `observe`:
   - for MQTT, `createMqttObserver({ subscriber: { network, destination, clientId, username?, password? }, fields, application, context, ingestOperation })`;
   - for OPC UA, an `OpcUaClient({ network, destination, endpointUrl })` passed to `createOpcUaObserver({ client, fields, ... })`.
5. Call `start(intervalMs, onError)` and return the observer so the [host](../../../../docs/glossary.md#host) stops it.
6. Bind the [destination](../../../../docs/glossary.md#destination) in the [deployment policy](../../../../docs/glossary.md#deployment-policy): `tcp://broker:1883`, `tls: true` for 8883, or `tcp://gateway:4840`. The `deploy-to-site` skill (`plugins/site/skills/deploy-to-site/SKILL.md`) has the policy steps.
7. Take broker credentials from the deployment, never from code.

## Checks

- Test against the fakes: `FakeBroker` with `encodeSparkplug` from `@agent-native/connector-mqtt/testing`, or `FakeOpcUaServer` from `@agent-native/connector-opcua/testing`. `plugins/connector-mqtt/test/connector-mqtt.test.ts` and `plugins/connector-opcua/test/connector-opcua.test.ts` show the wiring. Cover:
  - a value becoming a reading;
  - a death or lost connection making it `uncertain`;
  - the ingest command's handling of both.
- Check that nothing is written. The fake broker records anything published, and the fake OPC UA server records every request.

```sh
bun test plugins/connector-mqtt plugins/connector-opcua packages/observation
bun test examples/<app>
```

The fakes prove the wiring. Record a run against a real broker, edge node or server separately in [implementation status](../../../../docs/implementation-status.md#connector-plugins).

## References

- [`@agent-native/observation`](../../README.md)
- [MQTT](../../../../plugins/connector-mqtt/README.md)
- [OPC UA](../../../../plugins/connector-opcua/README.md)

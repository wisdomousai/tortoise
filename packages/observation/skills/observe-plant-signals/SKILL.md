---
name: observe-plant-signals
description: Read values from plant control systems into an agent-native application as gated readings, through an MQTT broker (plain topics or Sparkplug B) or an OPC UA server. Use when a module needs machine state, counters or process values that only a broker or controller gateway has, when writing an ingest command for such readings, or when binding a broker or OPC UA server in a site policy. Covers packages/observation, plugins/connector-mqtt and plugins/connector-opcua.
---

# Observe plant signals

A broker or an OPC UA server is a source that can be read but not queried for history or written. Its values become readings with provenance and confidence, and an ingest command decides what they change. Readings are claims about the source, not facts. The [observation package README](../../README.md) explains the gate and the idempotency keys; the [MQTT](../../../../plugins/connector-mqtt/README.md) and [OPC UA](../../../../plugins/connector-opcua/README.md) READMEs list the options and limits.

## Before writing

- List each field: its ID, where it comes from (a Sparkplug group, node, optional device and metric; a plain topic and JSON pointer; or an OPC UA node ID such as `ns=2;s=Press.Temperature`), and how many equal reads make it stable.
- Decide what an `uncertain` reading means in the domain: a stale Sparkplug value, an uncertain or bad OPC UA status, or a lost connection all arrive as `uncertain` and should reach a person, not a record.
- Both connectors only read. A write to a controller is a declared procedure with readback, which these connectors do not offer; see the `write-hardware-driver` skill (`plugins/connector-driver/skills/write-hardware-driver/SKILL.md`) for actions on equipment.

## Steps

1. **Declare the source** in the manifest's `components`: `mqttBroker({ id, destination, description, dataClasses })` or `opcUaServer({ ... })`. Each declares a `site`-scoped `tcp` destination with offline `degrade`.
2. **Write the ingest command** with the `add-capability` skill (`packages/runtime/skills/add-capability/SKILL.md`). Its input is the observation (or what `toInput` maps it to); it records stable readings and raises attention for uncertain ones. Grant it, and nothing else, to the observing principal.
3. **Start the observer** in `connect`'s `observe`: `createMqttObserver({ subscriber: { network, destination, clientId, username?, password? }, fields, application, context, ingestOperation })`, or an `OpcUaClient({ network, destination, endpointUrl })` passed to `createOpcUaObserver({ client, fields, ... })`. Call `start(intervalMs, onError)` and return the observer so the host stops it.
4. **Bind the destination** in the site policy (`tcp://broker:1883`, `tls: true` for 8883, or `tcp://gateway:4840`), as in the `deploy-to-site` skill (`plugins/site/skills/deploy-to-site/SKILL.md`). Broker credentials come from the deployment, never from code.

## Checks

- Test against the fakes: `FakeBroker` with `encodeSparkplug` from `@agent-native/connector-mqtt/testing`, or `FakeOpcUaServer` from `@agent-native/connector-opcua/testing`. Cover a value becoming a reading, a death or lost connection making it `uncertain`, and the ingest command's handling of both (`plugins/connector-mqtt/test/connector-mqtt.test.ts` and `plugins/connector-opcua/test/connector-opcua.test.ts` show the wiring).
- Check that nothing is written: the fake broker records anything published, and the fake OPC UA server records every request.

```sh
bun test plugins/connector-mqtt plugins/connector-opcua packages/observation
bun test examples/<app>
```

The fakes prove the wiring. A run against a real broker, edge node or server is recorded separately in [implementation status](../../../../docs/implementation-status.md#connector-plugins).

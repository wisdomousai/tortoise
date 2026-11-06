---
name: observe-plant-signals
description: Read MQTT, Sparkplug B or OPC UA values as observations. Use when defining stable readings and their ingest command, configuring connector destinations, or testing loss and uncertain source values.
---

# Observe plant signals

The MQTT and OPC UA connectors consume current values as observations. Their interfaces provide read access and do not implement controller writes or history queries. An application ingest command decides how an observation changes local records.

## Before writing

- List each field: its ID, where it comes from, and how many equal reads make it stable. A field comes from one of:
  - a Sparkplug group, node, optional device and metric;
  - a plain topic and JSON pointer;
  - an OPC UA node ID such as `ns=2;s=Press.Temperature`.
- Decide what an `uncertain` reading means in the domain. A stale Sparkplug value, an uncertain or bad OPC UA status, and a lost connection are all ingested as `uncertain`. Define the attention or recovery behavior for uncertain readings; do not store an uncertain value as a confirmed measurement.
- Both connectors only read. A write to a controller is a declared procedure with readback, which these connectors do not offer. For actions on equipment, see the `write-hardware-driver` skill (`plugins/connector-driver/skills/write-hardware-driver/SKILL.md`).

## Steps

1. Declare the source in the manifest's `components` with `mqttBroker({ id, destination, description, dataClasses })` or `opcUaServer({ ... })`. Each declares a `local`-scoped `tcp` destination with offline `degrade`.
2. Write the ingest command with the `add-capability` skill (`packages/runtime/skills/add-capability/SKILL.md`). Its input is the observation, or what `toInput` maps it to. It records stable readings and raises attention for uncertain ones.
3. Grant the ingest command, and nothing else, to the observing principal.
4. Create the observer in `connect`'s `observe`:
   - for MQTT, `createMqttObserver({ subscriber: { network, destination, clientId, username?, password? }, fields, application, context, ingestOperation })`;
   - for OPC UA, `createOpcUaObserver({ client: { network, destination, endpointUrl }, fields, ... })`.
5. Call `start(intervalMs, onError)` and return the observer so the host stops it.
6. Bind the destination in the deployment policy: `tcp://broker:1883`, `tls: true` for 8883, or `tcp://gateway:4840`. The `deploy-an-application` skill (`plugins/deployment/skills/deploy-an-application/SKILL.md`) has the policy steps.
7. Take broker credentials from the deployment, never from code.

## Checks

- Test against the fakes: `FakeBroker` with `encodeSparkplug` from `@tortoise/connector-mqtt/testing`, or `FakeOpcUaServer` from `@tortoise/connector-opcua/testing`. `start()` listens on a free loopback port and `start(port)` on a fixed one for a development launch. `plugins/connector-mqtt/test/connector-mqtt.test.ts` and `plugins/connector-opcua/test/connector-opcua.test.ts` show the wiring with a stub network port. `showcase/patterns/signals/test/signals.test.ts` goes through an embedded instance's network port with a deployment policy that binds the fakes. Cover:
  - a value becoming a reading;
  - a death or lost connection making it `uncertain`;
  - the ingest command's handling of both.
- Check that nothing is written. The fake broker records anything published, and the fake OPC UA server records every request.

```sh
bun test plugins/connector-mqtt plugins/connector-opcua packages/observation
bun test showcase/examples/<app>
```

Record a run against a real broker, edge node or server separately in [implementation status](../../../../docs/implementation-status.md#connector-plugins).

## References

- [`@tortoise/observation`](../../README.md)
- [MQTT](../../../../plugins/connector-mqtt/README.md)
- [OPC UA](../../../../plugins/connector-opcua/README.md)

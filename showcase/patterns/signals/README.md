# @agent-native/pattern-signals

`pattern-signals` composes the [base pattern](../base/README.md) unchanged with climate chambers, where samples are conditioned before testing. Chamber temperature comes from the chamber controllers over OPC UA, and humidity from one Sparkplug B edge node per chamber over MQTT. A technician places a test request's sample in a chamber, and the request screen shows whether that chamber holds its setpoint.

## Layer

Content (`showcase/patterns/*`). It imports the base pattern, the framework, `@agent-native/observation`, `@agent-native/connector-opcua`, `@agent-native/connector-mqtt` and the site, network and audit plugins.

## Primitives

The pattern is one [application](../../../docs/primitives.md#application). It composes:

- two [observations](../../../docs/primitives.md#observation): an OPC UA observer that needs two equal reads of a temperature, and a Sparkplug B observer that follows each edge node's birth, data and death messages;
- `chamber.reading.ingest`, the ingest command both observers submit through, as the `chamber-observer` [integration principal](../../../docs/glossary.md#integration-principal);
- two [host components](../../../docs/glossary.md#host-component), `chamber-gateway` and `chamber-broker`, whose [requirement declarations](../../../docs/primitives.md#requirement-declaration) a [deployment policy](../../../docs/primitives.md#deployment-policy) binds;
- the [egress guard](../../../docs/primitives.md#egress-guard) of the network plugin, which the observers' connections pass, and the [audit log](../../../docs/primitives.md#audit-log), which records them.

Its own files:

| File | Runs in | Holds |
| --- | --- | --- |
| `contracts.ts` | Browser and server | The `chambers` module: `chamber.list`, `chamber.conditions`, `chamber.place` and the ingest command, and both components |
| `domain.ts` | Server | The chamber definitions with their OPC UA node, Sparkplug metric, setpoint and tolerance, and the `chambers` slice |
| `handlers.ts` | Server | The chamber handlers. Ingest records a temperature or humidity as a condition |
| `policy.ts` | Server | The route for the `chambers` module, with the observer's lane |
| `observers.ts` | Server | `createChamberObservers`, both observers over the network port |
| `application.ts` | Server | The base handlers in the `testRequests` slice, the chamber handlers, both routes, the plugins and `connect`, which starts the observers |
| `screens.tsx`, `ui/chambers.tsx` | Browser | The climate chambers screen, and a chamber section on the base test request screen |
| `fake-plant.ts` | Server, tests and dev | `FakePlant`: `FakeOpcUaServer` with a temperature node per chamber, and `FakeBroker` with an edge node per chamber |
| `dev.ts`, `site-policy.dev.json` | Dev launch | Starts the plant stand-in on ports 4374 and 4373 and binds both destinations to it |

A condition is a value, when it was first observed, and a status:

| Ingested as | Condition |
| --- | --- |
| `observed` with a new number | The number, observed now |
| `observed` with the same number | Unchanged; nothing is written |
| `uncertain` | The last observed number, marked uncertain |

A chamber is conditioned when both its temperature and humidity are observed and within tolerance of the setpoint. A lost gateway connection, a dead edge node or a Sparkplug sequence gap makes the value uncertain, so the chamber stops counting as conditioned until the source confirms it again.

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/pattern-signals/manifest` | Browser and server | The test requests and chambers modules, both components and the site, network and audit plugin manifests |
| `@agent-native/pattern-signals/application` | Server | `createTestRequestsSignalsApplication` |
| `@agent-native/pattern-signals/screens` | Browser | The test request screens with a chamber section, and the climate chambers screen |

## Trust boundary

The observers reach the gateway and the broker only through the network port, so the site policy decides where `chamber-gateway` and `chamber-broker` point. Until it binds them, the observers reach nothing and no condition is recorded.

The observers submit as `chamber-observer`. Its lane admits only `chamber.reading.ingest` and no event, so a compromised gateway or broker can record conditions and nothing else. People cannot call the ingest command. Members read chambers, and technicians place samples.

Both connectors only read. The MQTT client subscribes and never publishes, and the OPC UA client uses the Read service. The OPC UA connection uses security policy None and an anonymous session, so it belongs on a segmented control network; the connector's README lists its limits. A real broker on port 8883 is bound with `tls: true`.

## Dependencies

`@agent-native/pattern-base`, `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/observation`, `@agent-native/connector-opcua`, `@agent-native/connector-mqtt`, `@agent-native/host`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit` and `@agent-native/frame`.

## Tests

```sh
bun test showcase/patterns/signals/
```

- `test/signals.test.ts`: the real observers against `FakePlant` on free ports, through the network port of an embedded instance whose site policy binds both destinations. A temperature counts after two equal reads and a humidity after the edge node's birth, a placed request shows its chamber, and a humidity outside the tolerance clears `conditioned`. A dead edge node and a stopped gateway leave the last values uncertain, and a new birth makes the humidity current again. The observer principal reads nothing and places nothing, people cannot ingest, and neither observer writes to the plant. A viewer cannot place a sample. Without a site binding, neither source is reached.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen in this pattern or the base.

Run the pattern in the browser:

```sh
cd showcase/patterns/signals
bun run dev:web
```

The plant stand-in serves OPC UA on `opc.tcp://127.0.0.1:4374` and MQTT on `tcp://127.0.0.1:4373`. Chamber 1 holds its setpoint. Chamber 2's humidity leaves its tolerance and comes back every two minutes.

## Skills

- [observe-plant-signals](../../../packages/observation/skills/observe-plant-signals/SKILL.md)
- [add-capability](../../../packages/runtime/skills/add-capability/SKILL.md)
- [build-screens](../../../packages/frame/skills/build-screens/SKILL.md)

## References

- [Patterns](../../../docs/patterns.md)
- [MQTT connector](../../../plugins/connector-mqtt/README.md)
- [OPC UA connector](../../../plugins/connector-opcua/README.md)
- [Observation](../../../packages/observation/README.md)

# @agent-native/connector-opcua

The OPC UA connector observes a server read-only. It polls node values with the Read service, and the values become gated [observations](../../docs/glossary.md#observation), submitted through the application's ingest command as the screen and driver observers do. The connector never writes to the server.

## Context

This connector is a library without plugin entrypoints. `./contracts` is browser-safe data; everything else is server only. The UA binary client is implemented here, with no client library. The server is input.

## Primitives

- [Observation](../../docs/primitives.md#observation): `createOpcUaObserver`, `opcUaServer`, with `OpcUaClient` underneath. The plugin implements no connector for a target.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/connector-opcua` | server | Everything below except `testing`. |
| `@agent-native/connector-opcua/contracts` | browser and server | `opcUaServer`. |
| `@agent-native/connector-opcua/client` | server | `OpcUaClient` (`connect`, `read`, `close`), `OpcUaError`. |
| `@agent-native/connector-opcua/types` | server | Node IDs in every binary form, variants, data values and status helpers (`isBad`, `isUncertain`). |
| `@agent-native/connector-opcua/observe` | server | `createOpcUaObserver`. |
| `@agent-native/connector-opcua/testing` | server (tests and development launches) | `FakeOpcUaServer`, a loopback server on a free or given port. |

`FakeOpcUaServer` has settable values, chunked responses, short token lifetimes, dropped sessions and a record of every request.

### Application wiring

- **Manifest:** list `opcUaServer({ id, destination, description, dataClasses })` in `components`. It declares a `site`-scoped `tcp` egress [destination](../../docs/glossary.md#destination) with offline `degrade`.
- **Deployment policy:** bind the destination to `tcp://plc-gateway:4840`.
- **`observe`:** build an `OpcUaClient({ network, destination, endpointUrl })`. Start `createOpcUaObserver({ client, fields: [{ id, node: 'ns=2;s=Press.Temperature', stableReads? }], application, context, ingestOperation })` with an interval. Stop the observer on shutdown, which closes the session.

### Client

The client opens a secure channel with security policy None, then creates and activates an anonymous session. It reads, then closes the session and the channel. It reassembles chunked responses and renews the channel token at 75% of its lifetime. It refuses a server that offers no anonymous endpoint without security, and says why.

Confidence follows the status code: good is 1, uncertain 0.5 and bad 0. A lost server keeps each field's last value with confidence 0. The observer sets `minConfidence` to 1, so anything short of a good read reaches the domain as `uncertain`.

## Trust boundary

Messages are capped at 16 MB and 512 chunks, and every read is bounds-checked. An array or structured value is skipped exactly and reported unsupported. The client sends only the services listed above, so it cannot change a value or call a method. Every connection goes through the network port to the bound destination. The observer submits as the principal in `context`, and the policy should grant that principal the ingest command only.

Security policy None means the traffic is neither signed nor encrypted, and the server cannot tell this client from another anonymous one. Use it only on a segmented control network, or behind a gateway that adds security. Signed and encrypted channels and non-anonymous sign-in are not implemented.

Limits:

- security policy None and anonymous sign-in only;
- polling with Read, and no subscriptions;
- scalar values only;
- no writes or method calls, so no declared procedures with readback yet.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/host/plugin`, `@agent-native/kernel/plugin`, `@agent-native/observation` and `@agent-native/runtime`. No external packages.

## Tests

```sh
bun test plugins/connector-opcua
```

`test/connector-opcua.test.ts` covers:

- node ID forms;
- skipping arrays and structures;
- a session that reads in chunks and closes;
- refusal of a server without an anonymous unsecured endpoint;
- token renewal;
- a fault for an ended session;
- the observer: observations, a lost server making them uncertain, and only reads sent.

## Task guides

- [observe-plant-signals](../../packages/observation/skills/observe-plant-signals/SKILL.md): declaring the source, writing the ingest command, starting the observer and binding the destination.

## References

- [Implementation status](../../docs/implementation-status.md#connector-plugins)

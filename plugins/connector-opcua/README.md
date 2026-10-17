# @agent-native/connector-opcua

Read-only observation of an OPC UA server. Node values are polled with the Read service and become gated readings, submitted through the application's ingest command as the screen and driver observers do. Nothing is ever written to the server.

Layer: plugins (`plugins/*`). `./contracts` is browser-safe data; everything else is server only. The UA binary client is implemented here, with no client library. [Observation](../../docs/primitives.md#observation) and [Connector](../../docs/primitives.md#connector) in the primitives index.

## Wiring an application

- **Manifest:** list `opcUaServer({ id, destination, description, dataClasses })` in `components`. It declares a `site`-scoped `tcp` egress destination with offline `degrade`.
- **Site policy:** bind the destination to `tcp://plc-gateway:4840`.
- **`observe`:** build an `OpcUaClient({ network, destination, endpointUrl })` and start `createOpcUaObserver({ client, fields: [{ id, node: 'ns=2;s=Press.Temperature', stableReads? }], application, context, ingestOperation })` with an interval. Stop it on shutdown; it closes the session.

## Contents

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/connector-opcua` | server | Everything below |
| `@agent-native/connector-opcua/contracts` | browser and server | `opcUaServer` |
| `@agent-native/connector-opcua/client` | server | `OpcUaClient` (`connect`, `read`, `close`), `OpcUaError` |
| `@agent-native/connector-opcua/types` | server | Node IDs in every binary form, variants, data values and status helpers (`isBad`, `isUncertain`) |
| `@agent-native/connector-opcua/observe` | server | `createOpcUaObserver` |
| `@agent-native/connector-opcua/testing` | server (tests) | `FakeOpcUaServer`: a loopback server with settable values, chunked responses, short token lifetimes, dropped sessions and a record of every request |

The client opens a secure channel with security policy None, creates and activates an anonymous session, reads, and closes the session and channel. It reassembles chunked responses and renews the channel token at 75% of its lifetime. It refuses a server that offers no anonymous endpoint without security, and says why.

Confidence follows the status code: good is 1, uncertain 0.5, bad 0. A lost server keeps each field's last value with confidence 0. With `minConfidence` 1, anything short of a good read reaches the domain as `uncertain`.

## Trust boundary

The server is input. Messages are capped at 16 MB and 512 chunks, every read is bounds-checked, and an array or structured value is skipped exactly and reported unsupported rather than guessed at. The client sends only the services listed above, so it cannot change a value or call a method. Every connection goes through the network port to the bound destination. The observer submits as the principal in `context`, which the policy should grant the ingest command only.

Security policy None means the traffic is neither signed nor encrypted, and the server cannot tell this client from another anonymous one. Use it only on a segmented control network, or behind a gateway that adds security. Signed and encrypted channels and user sign-in are not implemented.

Limits:

- security policy None and anonymous sign-in only;
- polling with Read; no subscriptions;
- scalar values only;
- no writes or method calls, so no declared procedures with readback yet.

## Tests

```sh
bun test plugins/connector-opcua
```

`test/connector-opcua.test.ts` covers node ID forms, skipping arrays and structures, a session that reads in chunks and closes, refusal of a server without an anonymous unsecured endpoint, token renewal, a fault for an ended session, and the observer: readings, a lost server making them uncertain, and only reads sent.

An interop run by hand against an independent server is recorded in the [implementation status](../../docs/implementation-status.md).

## Skills

- [observe-plant-signals](../../packages/observation/skills/observe-plant-signals/SKILL.md): declaring the source, writing the ingest command, starting the observer and binding the destination.

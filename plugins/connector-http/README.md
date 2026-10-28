# @agent-native/connector-http

The HTTP [connector](../../docs/glossary.md#connector) reaches a generic REST [system of record](../../docs/glossary.md#system-of-record) through the network port. The application describes the system as data: the request for each effect, the rejection statuses with their code and message, the lookup by key and the change feed.

## Context

This connector is a library without plugin entrypoints. Server only. It trusts the [deployment policy](../../docs/glossary.md#deployment-policy) to bind the address and credentials, and treats response bodies as input.

## Primitives

- [Connector](../../docs/primitives.md#connector): `httpTargetPort`, `readPointer`.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/connector-http` | server | `httpTargetPort`, `readPointer` and their types. |
| `@agent-native/connector-http/testing` | server (tests) | `FakeRestSystem`, a loopback REST server. |

`FakeRestSystem` has keyed orders, a 422 rejection, lookup by key, a paged change feed and injected failures.

### Application wiring

- **Manifest:** declare the system's network [destination](../../docs/glossary.md#destination) as `egress`, with its scope, data classes and availability. Name it in the target's capabilities, as for any outbox target.
- **`connect`:** build `httpTargetPort({ target, network: context.network, destination, request, idempotencyHeader?, rejections, lookup?, feed? })` and pass it to the target integration.

```ts
httpTargetPort({
  target: 'erp',
  network: context.network,
  destination: 'erp-api',
  request: (effect) => ({ path: '/orders', body: { ...effect.payload, ref: effect.id } }),
  idempotencyHeader: 'Idempotency-Key',
  rejections: [{ status: [409, 422], code: '/error/code', message: '/error/message' }],
  externalRef: '/id',
  lookup: { path: (effectId) => `/orders/by-key/${effectId}` },
  feed: { path: (cursor) => `/changes?after=${cursor ?? ''}`, items: '/items', cursor: '/cursor', more: '/more', map },
});
```

The `externalRef`, `items`, `cursor` and `more` fields are JSON pointers (RFC 6901) into the response body. A rule's `code` and `message` are pointers when they start with `/`, and literal text otherwise.

### Outcomes

- A 2xx is accepted, or pending when its status is in `pendingStatus`.
- A status that a rejection rule lists is rejected with the code and message the rule points at, so a rejection is business data.
- Anything else is a transient failure that the [dispatcher](../../docs/glossary.md#dispatcher) retries. That includes a dropped connection, a body cut off and a timeout (`timeoutMs`, 30 seconds by default).

The port needs an idempotency header, a lookup, or both. With a header, the system deduplicates a resend, and the port describes itself as idempotent. With only a lookup, the dispatcher asks before every resend. A lookup that returns 404 means the system never received the request, and `pendingWhen` marks a found record that has not been decided.

## Trust boundary

Every request goes through `network.client(destination).fetch`, so the [egress guard](../../docs/glossary.md#egress-guard) sees it and the deployment policy decides the address and credentials. The port never reads a credential.

Response bodies are input. Rejection codes and messages are cut to 100 and 500 characters. The feed's `map` and the sync command's input schema decide what an item may change.

Limits:

- JSON bodies only;
- no pagination other than a cursor in the body;
- no retry-after handling beyond the dispatcher's backoff.

## Dependencies

Framework: `@agent-native/integration`, `@agent-native/kernel` (`plugin`) and `@agent-native/runtime`. The tests use `@agent-native/testing/connectors`. No external packages.

## Tests

```sh
bun test plugins/connector-http
```

`test/connector-http.test.ts` runs the shared connector conformance suite against `FakeRestSystem` twice: deduplicating by header, and by lookup only. The suite's inbound checks exercise the change feed. The file also covers:

- rejection mapping;
- unlisted statuses and an unreachable system as transient;
- the refusal of a target with neither header nor lookup;
- requests reaching only the declared destination;
- pending statuses and pending lookup bodies;
- pointer escapes.

## Task guides

- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md): wiring a target, its outbox and inbound sync, with a REST system as one of the ports.

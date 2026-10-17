# @agent-native/connector-http

A generic REST system of record behind the network port. The application describes the system as data: how an effect becomes a request, which statuses are business rejections and where their code and message are, how to look a request up by key, and where the change feed is.

Layer: plugins (`plugins/*`). Server only. [Connector](../../docs/primitives.md#connector) in the primitives index.

## Wiring an application

- **Manifest:** declare the system's network destination (`egress`, with its scope, data classes and availability) and name it in the target's operations, as for any outbox target.
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

## Contents

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/connector-http` | server | `httpTargetPort`, `readPointer` and their types |
| `@agent-native/connector-http/testing` | server (tests) | `FakeRestSystem`: a loopback REST server with keyed orders, a 422 rejection, lookup by key, a paged change feed and injected failures |

Outcomes:

- a 2xx is accepted, or pending when its status is in `pendingStatus`;
- a status a rejection rule lists is rejected with the code and message it points at, so a rejection is business data;
- anything else, a dropped connection, a timeout (`timeoutMs`, default 30 s) or a body cut off, is a transient failure the dispatcher retries.

The port needs an idempotency header, a lookup, or both. With a header the system deduplicates a resend, and the port describes itself as idempotent. With only a lookup the dispatcher asks before every resend; a lookup that answers 404 means the request never arrived, and `pendingWhen` marks a found record that has not been decided.

## Trust boundary

Every request goes through `network.client(destination).fetch`, so the egress guard sees it and the site policy decides the address and credentials. The port never reads a credential. Response bodies are input: rejection codes and messages are cut to 100 and 500 characters, and the feed's `map` and the sync command's input schema decide what an item may change.

Limits: JSON bodies only; no pagination other than a cursor in the body; no retry-after handling beyond the dispatcher's backoff.

## Tests

```sh
bun test plugins/connector-http
```

`test/connector-http.test.ts` runs the shared connector conformance suite against `FakeRestSystem` twice, deduplicating by header and by lookup only; the suite's inbound checks exercise the change feed. It also covers rejection mapping, unlisted statuses and an unreachable system as transient, the refusal of a target with neither header nor lookup, requests reaching only the declared destination, pending statuses and pending lookup bodies, and pointer escapes.

## Skills

- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md): wiring a target, its outbox and inbound sync, with a REST system as one of the ports.

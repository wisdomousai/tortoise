# @agent-native/client

This package is the typed client every non-React [caller](../../docs/glossary.md#caller) uses. It holds a `Transport` interface over the [instance](../../docs/glossary.md#instance)'s query, command and change-event endpoints, an HTTP implementation, typed [capability](../../docs/glossary.md#capability) calls and `LiveQuery`. Browsers, scripts, the MCP bridge and the React bindings share it, so a person and an agent see the same receipts and the same live updates.

## Layer

Framework (`packages/*`). Browser-safe. It trusts its transport to carry the caller's identity.

## Primitives

- [Journal and live query](../../docs/primitives.md#journal-and-live-query): `createClient`, `createHttpTransport`, `LiveQuery`, `Snapshot`, `Receipt`, `ChangeBatch`. A `LiveQuery` keeps one query result current by following the journal from the query's own cursor.
- [Blob store](../../docs/primitives.md#blob-store): `Transport.blobs`, typed `BlobTransport` and `BlobReference`, which the HTTP transport implements over `/api/v1/blobs`.

[State and reactivity](../../docs/state-and-reactivity.md#live-queries) describes how a [live query](../../docs/glossary.md#live-query) reads a snapshot and then follows the journal.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/client` | browser and server | `Transport`, `createHttpTransport`, `createClient`, `LiveQuery`, `LiveState` and wire types. |
| `@agent-native/client/*` | browser and server | One source file: `types`, `http-transport`, `client` or `live-query`. |

## Trust boundary

The transport carries no identity of its own. A trusted process injects a bearer token with `createHttpTransport({ token })`. A browser relies on the HttpOnly session cookie and passes no token. A `LiveQuery` is scoped by its transport to one instance, principal and grant. It must never be shared across authenticated sessions.

A reset batch, sent on an authorization change, clears cached data at once, even while a refresh is pending. A generation fence stops an older or failed request from restoring revoked or superseded data. A receipt's `effects` prove the local commit only. Delivery is reported later through effect state.

## Dependencies

Framework: `@agent-native/contracts`. The client uses the global `fetch` unless one is injected. Browser code is outside the egress rule.

## Tests

```sh
bun test packages/client
```

`src/client.test.ts` covers:

- the snapshot cursor closing the race between reading the snapshot and following the journal;
- a revocation reset clearing data behind a pending refresh;
- stopping a live query, after which late responses are dropped;
- an older failure, which cannot erase a newer snapshot;
- HTTP errors, which keep caller-safe field details.

## Skills

None. Screens use the client through `packages/react` and the frame, which the [build-screens](../frame/skills/build-screens/SKILL.md) skill covers.

# @agent-native/client

The typed client every non-React caller uses: a `Transport` interface over the authority's query, command and change-event endpoints, an HTTP implementation, typed capability calls and `LiveQuery`, which keeps one query result current by following the journal from the query's own cursor. Browsers, scripts, the MCP bridge and the React bindings share it, so a person and an agent see the same receipts and the same live updates.

Layer: framework (`packages/*`). Browser-safe.

## Primitives

- [Journal and live query](../../docs/primitives.md#journal-and-live-query): `createClient`, `createHttpTransport`, `LiveQuery`, `Snapshot`, `Receipt`, `ChangeBatch`.

[State and reactivity](../../docs/state-and-reactivity.md) describes the snapshot-then-subscribe protocol.

## Entrypoints

| Import                   | Runs in            | Contents                                                                                     |
| ------------------------ | ------------------ | -------------------------------------------------------------------------------------------- |
| `@agent-native/client`   | browser and server | `Transport`, `createHttpTransport`, `createClient`, `LiveQuery`, `LiveState` and wire types. |
| `@agent-native/client/*` | browser and server | One source file: `types`, `http-transport`, `client` or `live-query`.                        |

## Trust boundary

The transport carries no identity of its own. A trusted process injects a bearer token (`createHttpTransport({ token })`); a browser relies on the HttpOnly session cookie and passes no token. A `LiveQuery` is scoped to one authority, principal and grant by its transport and must never be shared across authenticated sessions.

A reset batch (an authorization change) clears cached data at once, even while a refresh is pending. A generation fence stops an older or failed request from restoring revoked or superseded data. A receipt's `effects` prove the local commit only; delivery is reported later through effect state.

## Dependencies

Framework: `@agent-native/contracts`. Uses the global `fetch` unless one is injected; browser code is outside the egress rule.

## Tests

```sh
bun test packages/client
```

`src/client.test.ts`: the snapshot cursor closes the subscription race, a revocation reset clears data behind a pending refresh, unsubscribe stops late responses, an older failure cannot erase a newer snapshot, and HTTP errors keep caller-safe field details.

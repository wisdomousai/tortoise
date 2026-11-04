---
'@tortoise/contracts': minor
'@tortoise/runtime': minor
'@tortoise/integration': minor
'@tortoise/kernel': minor
'@tortoise/host': minor
'@tortoise/adapters': minor
'@tortoise/testing': minor
'@tortoise/site': minor
'@tortoise/device-link': minor
'@tortoise/fleet-agent': minor
'@tortoise/workflows': minor
'@tortoise/peer-link': minor
---

Nested calls, durable workflows and calls between two applications.

- A handler calls the operations its capability lists in `invokes` with `ctx.invoke` and `ctx.query`, inside its own transaction. Each call is authorized on its own, at most 4 levels deep and 64 per command, and replay authorizes each again.
- `defineWorkflow` declares steps that run commands and wait on queries, with retries and compensations. The `workflows` host plugin runs instances as the person who started them.
- An application publishes a peer API with `definePeerApi` and serves it through the `peer-link` plugin. Another application declares it with `definePeerTarget`, connects with a one-use code, and calls it as its service principal or, with a signed subject assertion, on behalf of a mapped person. `createPeerDrift` keeps calls to an operation whose schema changed at the peer pending.
- `/api/v1/contract` names the application and gives each operation a `schemaDigest`.
- A destination declared `authenticated` is refused when bound to plain text off loopback. Peer targets, the fleet agent's `fleet` and hub-link's `hub` destinations are declared so.
- The one-use code and credential helpers move from the device link to `@tortoise/host/enrollment`.
- A plugin's `authenticate` also receives the request that carried the token.
- Inbound sync idempotency keys name the sync operation, so two targets synced by one integration principal no longer collide.

Breaking changes:

- `continueWith` runs the continued command as a nested call. The calling capability must list that command in `invokes`, or `'any'`, and the nesting limits apply.
- A resource that both an outer and a nested command declare gets one journal entry, with the type and operation of the innermost frame that declared it.
- The peer port holds an effect when the peer returns `IDEMPOTENCY_CONFLICT`, instead of rejecting it. It reads the external reference from the command's result through its `reference` option.

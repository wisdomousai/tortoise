# @tortoise/client

`@tortoise/client` provides the typed client used to invoke catalog operations through a transport. `createClient` exposes command and query methods. `createHttpTransport` sends those requests to an instance; its caller supplies the bearer credential when one is required.

`LiveQuery` obtains a snapshot and follows subsequent journal events from that snapshot's cursor. Authorization resets clear cached results before the client reads again. Transport errors retain the application's safe error details. The client does not establish the caller's identity or authorize a record change.

## References

[build-screens](../frame/skills/build-screens/SKILL.md)

[Operations and state](../../docs/capability-authoring.md#live-queries)

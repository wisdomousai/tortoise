# @agent-native/client

Typed command and query calls for non-React code: scripts, the MCP bridge and the React bindings. `LiveQuery` follows the journal to keep a result current. The transport has no identity of its own; a trusted process injects a bearer token with `createHttpTransport({ token })`.

- Primitives: [Journal and live query](../../docs/primitives.md#journal-and-live-query), [Blob store](../../docs/primitives.md#blob-store).

## References

- [build-screens](../frame/skills/build-screens/SKILL.md)
- [State and reactivity](../../docs/state-and-reactivity.md#live-queries)

# Add a capability

Start with the desired user action or query and its permission/resource boundary. Follow `docs/capability-authoring.md` in the target checkout.

- Add a stable ID and JSON-only input/output schemas to a browser-safe feature module.
- Supply a separately registered server handler, injected domain services and authorization for operation/object/row/field access. Declare committed changed-resource references.
- Bind the capability to an authored UI action or live query, or document its deliberate headless exception.
- Add authored workflow references where agents need guidance; workflows reference canonical operation IDs rather than transport-specific tool names.
- For a write another system must accept, enqueue an outbox effect on a declared changed resource, declare `integration` on the capability, and record outcomes in a separate settle command; never call the target inside the handler.
- Add a behavioral scenario proving permitted behavior and denial, including another-process visibility for writes that affect subscribed screens.

Compose through the existing application root, regenerate artifacts, and run type/boundary/schema/conformance checks. Preserve literal operation typing. Never create a second writable store or duplicate a handler in an API, MCP tool, CLI command or agent adapter.

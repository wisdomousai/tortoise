# Add a capability

Start with the desired user action or query and its permission/resource boundary. Follow `docs/capability-authoring.md` in the target checkout.

- Add a stable ID and JSON-only input/output schemas to a browser-safe feature module.
- Supply a separately registered server handler, injected domain services and authorization for operation/object/row/field access. Declare committed changed-resource references.
- Bind the capability to an authored UI action or live query, or document its deliberate headless exception.
- Add authored workflow references where agents need guidance; workflows reference canonical operation IDs rather than transport-specific tool names.
- Add a behavioral scenario proving permitted behavior and denial, including another-process visibility for writes that affect subscribed screens.

Compose through the existing application root, regenerate artifacts, and run type/boundary/schema/conformance checks. Preserve literal operation typing. Never create a second writable store or duplicate a handler in an API, MCP tool, CLI command or agent adapter.

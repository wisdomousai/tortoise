# Interaction contract

The contract is a browser-safe description of the application. Modules own their domain schemas and stable operation IDs, and the framework owns the shared protocol types. Building the catalog loads no handlers, storage or providers, so the result is deterministic and serializable ([P2](principles.md#p2--the-catalog-describes-the-application)).

## Schemas

Schemas are Zod 4, exported as JSON Schema 2020-12. Wire values are plain JSON: finite numbers, strings, booleans, null, arrays and plain objects. Validation rejects any parse that would strip or transform what was submitted, so coercion, defaults and transforms are not used. Use strict objects for DTOs. An optional protected field may be absent, but `undefined` is not a wire value.

## Catalog

The catalog holds schemas, permission requirements, dependencies, MCP names, UI bindings or exceptions, and workflow references. Handlers, resource resolvers and policy are separate server contributions. Validation rejects duplicate IDs, missing or cyclic dependencies, missing UI declarations, unresolved workflows and colliding MCP names. IDs are the same on every surface. MCP replaces dots and hyphens with underscores and checks for collisions and length. A UI declaration states coverage; scenarios and UI tests show behavior.

Handlers are registered against their exact capability, and typed `invoke` and `query` follow from the composed modules. Dynamic transports use the raw variants, which run the same validation and authorization. Types are never reconstructed from runtime discovery.

## Results, cursors and events

A command returns the operation, result, cursor, authorization revision and changed revisions. A query returns data, cursor and authorization revision. Internal cursors are per-workspace integers. Over HTTP they become opaque, caller-bound strings that clients pass back and never compare or construct. Event batches carry only authorized resource references and the current cursor. Discovery marks resource-dependent permissions as conditional, but every call authorizes on its own.

Streaming transports enqueue events inside the storage read boundary, so a permission change cannot slip between the check and the send. Asynchronous delivery callbacks are rejected.

## Errors

Shared error codes distinguish invalid input or output, unknown operations, forbidden access, revision conflicts, idempotency conflicts, cancellation and internal failure. Transports map application errors to one envelope, and unknown exceptions become a generic internal error. Messages and details that a handler sets on purpose stay safe for the caller.

## Versions and idempotency

The application contract version defaults to `1.0.0`. A breaking change to an operation's input or output gets a new version and a migration note. An idempotency fingerprint covers the version, operation, validated input, expected revisions and run or grant context. Keys are scoped to workspace and principal, and a key reused with a different fingerprint conflicts. A replay checks current access and reprojects output before returning the stored result. HTTP requires a key, while direct calls may omit it.

## Generated artifacts

`bun run generate` writes the catalog, schemas, OpenAPI, operation reference, workflows and each application's end-user skill to `docs/reference/<id>/`, and `bun run check:generated` fails on drift.

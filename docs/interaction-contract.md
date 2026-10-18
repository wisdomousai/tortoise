# Interaction contract

Every [surface](glossary.md#surface) shares one contract. Modules own their schemas and operation IDs; the framework owns the shared protocol types.

## Concepts

- [Idempotency key](glossary.md#idempotency-key): the caller's key that makes a repeated command return its first [receipt](glossary.md#receipt).
- [UI binding](primitives.md#capability-binding): the screen control a capability declares.
- [UI session context](primitives.md#ui-session-context): the selection a screen shares with an agent run.

## Schemas

Schemas are Zod 4, exported as JSON Schema 2020-12. Wire values are plain JSON: finite numbers, strings, booleans, null, arrays and plain objects. Defining a schema refuses coercion, defaults, transforms and custom refinements. Validation rejects a parse that would strip or change a submitted value. Use strict objects, and leave an optional protected field absent, because `undefined` is not a wire value.

## Catalog

Building the [catalog](glossary.md#catalog) loads no handlers, storage or providers, so the result is deterministic, serializable JSON. It holds each [capability](glossary.md#capability)'s schemas, permission, dependencies, MCP name and UI binding, and the workflows. Handlers and policy are separate server contributions. The build rejects duplicate operation IDs, missing or cyclic module dependencies, missing UI bindings, unknown workflow references and colliding MCP names.

Operation IDs are the same on every surface. An MCP name replaces dots and hyphens with underscores, up to 64 characters.

Each handler is registered against its exact capability, and the typed `invoke` and `query` follow from the composed modules. Surface adapters use the raw variants, which run the same validation and authorization. Types are never reconstructed from runtime discovery. Discovery marks capabilities outside the caller's [grant](glossary.md#grant) as denied, and every call still authorizes on its own.

## UI bindings

A capability declares a UI binding, or a UI exception that says why no [screen](glossary.md#screen) offers it. The catalog checks only the declaration, and an application's UI-binding test uses `unboundOperations` to find bound capabilities that no screen references. Whether a control renders needs a browser test. A module adds workflow text when agents need a sequence of capabilities.

The React capability form validates with the capability's schema. It keeps one idempotency key for every retry until the command commits.

## UI session context

A screen registers the resources a person selected and the [revision](glossary.md#revision) observed for each. The host checks that the caller may read each one and that no revision is ahead of the [authority](glossary.md#authority). An [agent run](glossary.md#agent-run) started from the screen captures this context and does not follow later selection changes. [Authorization](authorization.md) covers the intents a run sends back.

## Results

| Call | Fields |
| --- | --- |
| Command | `operation`, `result`, `cursor`, `authorizationRevision`, changed `revisions`, `effects` if any |
| Query | `data`, `cursor`, `authorizationRevision` |

## Errors

Shared error codes distinguish invalid input or output, unknown operations, forbidden access, revision conflicts, idempotency conflicts, cancellation, an unavailable dependency and internal failure. Surface adapters map an `ApplicationError` to one envelope with its code, message and details. Any other exception becomes a generic internal error. [Systems of record](systems-of-record.md) lists the CLI exit codes.

## Versions and idempotency

The contract version defaults to `1.0.0`. Give a breaking change to a capability's input or output a new version and a migration note. The idempotency fingerprint covers the contract version, operation ID, validated input, expected revisions, run and grant. A key is scoped to the workspace and [principal](glossary.md#principal), and a key reused with a different fingerprint conflicts. A replay rechecks current access and projects the stored result again, without running the handler.

HTTP and MCP require a key for a command, the CLI generates one, and direct calls may omit it.

## Generated reference

`bun run generate` writes each application's catalog, OpenAPI document, operation reference, workflows, security manifest, data flows and agent skill to `dist/reference/<id>/`. Nothing generated is committed. `bun run check` runs the generator, so a catalog that cannot be documented fails.

## Related pages

[Capability authoring](capability-authoring.md), [state and reactivity](state-and-reactivity.md) and [authorization](authorization.md).

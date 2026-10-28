# Interaction contract

Every [surface](glossary.md#surface) shares one contract. Modules own their schemas and operation IDs; the framework owns the shared protocol types.

## Concepts

Terms: [idempotency key](glossary.md#idempotency-key), [display metadata](glossary.md#display-metadata), [UI binding](glossary.md#ui-binding), [UI session context](glossary.md#ui-session-context) and [UI intent](glossary.md#ui-intent).

## Schemas

Schemas are Zod 4, exported as JSON Schema 2020-12. Wire values are plain JSON: finite numbers, strings, booleans, null, arrays and plain objects. Defining a schema refuses coercion, defaults, transforms and custom refinements. Validation rejects a parse that would strip or change a submitted value. Use strict objects, and leave an optional protected field absent, because `undefined` is not a wire value.

## Catalog

Building the [catalog](glossary.md#catalog) loads no handlers, storage or providers, so the result is deterministic, serializable JSON. It holds each [capability](glossary.md#capability)'s schemas, permission, dependencies, MCP name and UI binding, and the workflows. Handlers and policy are separate server contributions. The build rejects duplicate operation IDs, missing or cyclic module dependencies, missing UI bindings, unknown workflow references and colliding MCP names.

A capability's display metadata names the operation and describes the records its output holds. A list's metadata describes the items of its `items` array. The build rejects a title field, key or shown field that the output record does not have, a repeated field and a label longer than one line. A generated collection read takes its display metadata from the collection's label, type, title field and fields.

The metadata is read in these places:

- `CollectionScreen` and `RecordScreen` take their columns, headings and record title from it, and link a record to its screen through `screens.resources`;
- the capability form and the command palette show the label;
- the MCP adapter puts the label in the tool title and adds the resource kind and fields to the tool description;
- the generated reference and application skill list each operation's display line and the operations that return records.

A capability without display metadata is shown from its schema.

Operation IDs are the same on every surface. An MCP name replaces dots and hyphens with underscores, up to 64 characters.

Each handler is registered against its exact capability, and the typed `invoke` and `query` follow from the composed modules. Surface adapters use the raw variants, which run the same validation and authorization. Types are never reconstructed from runtime discovery. Discovery marks capabilities outside the caller's [grant](glossary.md#grant) as denied, and every call still authorizes on its own. `/api/v1/contract` also names the `application` (its ID, contract version and a digest of every operation) and gives each operation a `schemaDigest` (`operationSchemaDigest`), so a caller learns when an operation it was built for changed.

## UI bindings

A capability declares a UI binding, or a UI exception that says why no [screen](glossary.md#screen) offers it. The catalog checks only the declaration, and an application's UI-binding test uses `unboundOperations` to find bound capabilities that no screen references. A module adds workflow text when agents need a sequence of capabilities.

The React capability form validates with the capability's schema. It keeps one idempotency key for every retry until the command commits.

## UI session context

A screen registers the resources a person selected and the [revision](glossary.md#revision) observed for each. The host checks that the caller may read each one and that no revision is ahead of the [instance](glossary.md#instance). An [agent run](glossary.md#agent-run) started from the screen captures this context and does not follow later selection changes.

## UI intents

A run that captured a UI session context gets four run tools beside the application tools. Each sends one UI intent to that session:

| Run tool | Intent | Screen behavior |
| --- | --- | --- |
| `ui.open` | `openResource` | Navigates to the screen `screens.resources` gives for the resource kind |
| `ui.select` | `selectResource` | Selects the resource on the current screen, or rejects a kind the screen does not show |
| `ui.prepare` | `prepare` | Fills the form of a command for the person to check and submit |
| `ui.request-review` | `requestReview` | Shows a review with a title, operations and the records to look at |

The UI session store accepts an intent from a run only for the session the run captured. The run's principal and workspace must match the session's, the run must not be cancelled, and the session must still be live. The host then checks that the run may read every named resource and that its kind is a selectable resource. A review's operations must be in the catalog. A prepared form must belong to a command with a UI binding; its values are untrusted, and the command validates them when the person submits it as themselves. An intent that fails a check is refused, and the run sees the error.

Intents change no records and are not journaled. The screen polls for them through `useUiSession`, and each ends as accepted, rejected or expired. By default a prepared form is held for the form that binds the command, as an OS request's prefill is, and `CapabilityForm` shows it with a notice.

## Results

| Call | Fields |
| --- | --- |
| Command | `operation`, `result`, `cursor`, `authorizationRevision`, changed `revisions`, `effects` if any |
| Query | `data`, `cursor`, `authorizationRevision` |

## Errors

Shared error codes distinguish invalid input or output, unknown operations, forbidden access, revision conflicts, idempotency conflicts, cancellation, an unavailable dependency and internal failure. Surface adapters map an `ApplicationError` to one envelope with its code, message and details. Any other exception becomes a generic internal error.

## Versions and idempotency

The contract version defaults to `1.0.0`. Give a breaking change to a capability's input or output a new version and a migration note. The idempotency fingerprint covers the contract version, operation ID, validated input, expected revisions, run and grant. A key is scoped to the workspace and [principal](glossary.md#principal), and a key reused with a different fingerprint conflicts. A call a peer application makes for one of its people (`ExecutionContext.peer.subject`) is scoped to the peer instead, and its fingerprint adds the principal it was mapped to, so a retry after the mapping changed conflicts instead of running again. A replay rechecks current access and projects the stored result again, without running the handler.

HTTP and MCP require a key for a command, the CLI generates one, and direct calls may omit it.

## Generated reference

`bun run generate` writes each application's catalog, OpenAPI document, operation reference, workflows, security manifest, data flows and agent skill to `dist/reference/<id>/`. Nothing generated is committed. `bun run check` runs the generator, so a catalog that cannot be documented fails.

## References

- [Capability authoring](capability-authoring.md)
- [State and reactivity](state-and-reactivity.md)
- [Authorization](authorization.md)
- [Systems of record](systems-of-record.md)

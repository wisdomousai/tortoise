# Interaction contract

Every surface shares one contract. Modules own their schemas and operation IDs. The framework owns the shared protocol types.

## Schemas

Schemas are Zod 4; the catalog exports them as JSON Schema 2020-12. Wire values are plain JSON: finite numbers, strings, booleans, null, arrays and plain objects. Schema definitions refuse coercion, defaults, transforms and custom refinements. Validation rejects a parse that strips or changes a submitted value. Use strict objects, and leave an optional protected field absent — `undefined` is not a wire value.

## Catalog

Building the catalog loads no handlers, storage or providers — the result is deterministic, serializable JSON. It contains each capability's schemas, permission, dependencies, MCP name and UI binding, plus the workflows. Handlers and policy are separate server contributions.

The build rejects:

- Duplicate operation IDs
- Missing or cyclic module dependencies
- Missing UI bindings
- Unknown workflow references
- Colliding MCP names

Display metadata names the operation and describes the records its output contains. A list's metadata describes the items of its `items` array. Each shown field has a name, an optional label and an optional kind: `text`, `date`, `date-time`, `status` with the tones of its values, `reference` with the resource kind it names, or `file`. The build rejects a title field, key or shown field that the output record does not have, a repeated field, a label longer than one line, an unknown kind or tone, tones on a field that is not a status, and a reference without a resource kind. A generated collection read takes its display metadata from the collection's label, type, title field and fields.

Who reads the metadata:

- `CollectionScreen` and `RecordScreen` take their columns, headings and record title from it, render each field by its kind, show a reference by the referenced record's title, and link a record to its screen through `screens.resources`
- The capability form takes each field's label and kind from it: a date input, a status choice, a picker over the referenced collection's list, a file input
- The capability form and the command palette show the label
- The MCP adapter puts the label in the tool title and adds the resource kind and fields to the tool description
- The generated reference and application skill list each operation's display line and the operations that return records

A capability without display metadata falls back to its schema.

Operation IDs are the same on every surface. An MCP name replaces dots and hyphens with underscores, up to 64 characters.

A handler registers against its exact capability; typed `invoke` and `query` follow from the composed modules. Surface adapters use the raw variants, which run the same validation and authorization. No type comes from runtime discovery.

Discovery marks capabilities outside the caller's grant as denied, and every call still authorizes on its own. `/api/v1/contract` also names the `application` (its ID, contract version and a digest of every operation) and gives each operation a `schemaDigest` (`operationSchemaDigest`), so a caller learns when an operation it depends on changed.

## UI bindings

A capability declares a UI binding, or a UI exception saying why no screen offers it. The catalog checks only the declaration; `unboundOperations` finds bound capabilities no screen references. A module adds workflow text when agents need a sequence of capabilities.

The React capability form validates with the capability's schema and keeps one idempotency key for every retry until the command commits.

## UI session context

A screen registers the resources a person selected and the revision it observed for each. The host checks that the caller may read each one and that no revision is ahead of the instance. An agent run started from the screen captures this context; later selection changes do not retarget it.

## UI intents

A run that captured a UI session context gets four run tools beside the application tools. Each sends one UI intent to that session:

| Run tool | Intent | Screen behavior |
| --- | --- | --- |
| `ui.open` | `openResource` | Navigates to the screen `screens.resources` gives for the resource kind |
| `ui.select` | `selectResource` | Selects the resource on the current screen, or rejects a kind the screen does not show |
| `ui.prepare` | `prepare` | Fills the form of a command for the person to check and submit |
| `ui.request-review` | `requestReview` | Shows a review with a title, operations and the records to look at |

The UI session store accepts an intent from a run only for the session it captured. Checks:

- The run's principal and workspace must match the session's
- Nobody has cancelled the run
- The session must still be live
- The run must be able to read every named resource
- Each resource kind must be selectable

A review's operations must be in the catalog. A prepared form must belong to a command with a UI binding; its values are untrusted, and the command validates them when the person submits. A failed check refuses the intent, and the run sees the error.

Intents change no records and leave no journal entry. The screen polls for them through `useUiSession`, and each ends as accepted, rejected or expired. An intent a run sent includes the run's ID, so a review can name the run that asked for it. By default the screen stores a prepared form for the form that binds the command, as it stores an OS request's prefill, and `CapabilityForm` shows it with a notice. A screen whose form has a route of its own passes a `prepare` handler. The handler gets the intent's ID, stores the prefill with `holdRunPrefill` and opens that route.

## Results

| Call | Fields |
| --- | --- |
| Command | `operation`, `result`, `cursor`, `authorizationRevision`, changed `revisions`, `effects` if any |
| Query | `data`, `cursor`, `authorizationRevision` |

## Errors

Shared error codes:

- invalid input or output
- unknown operation
- forbidden access
- revision conflict
- idempotency conflict
- cancellation
- unavailable dependency
- internal failure

Surface adapters map an `ApplicationError` to one envelope with its code, message and details. Any other exception becomes a generic internal error.

## Versions and idempotency

The contract version defaults to `1.0.0`. A breaking change to a capability's input or output takes a new version and a migration note.

The idempotency fingerprint covers:

- The contract version and operation ID
- Validated input
- Expected revisions
- Run and grant

A key belongs to one workspace and principal; reusing a key with a different fingerprint conflicts. A call a peer application makes for one of its people (`ExecutionContext.peer.subject`) belongs to the peer instead, and its fingerprint adds the mapped principal, so a retry after the mapping changed conflicts instead of re-running. A replay rechecks current access and reprojects the stored result without running the handler.

HTTP and MCP require a key for a command, the CLI generates one, and direct calls may omit it.

## Generated reference

`bun run generate` writes each application's catalog, OpenAPI document, operation reference, workflows, security manifest, data flows and agent skill to `dist/reference/<id>/`. Commit nothing generated. `bun run check` runs the generator, so a catalog the generator cannot document fails.

## References

- [Capability authoring](capability-authoring.md)
- [State and reactivity](state-and-reactivity.md)
- [Authorization](authorization.md)
- [Systems of record](systems-of-record.md)

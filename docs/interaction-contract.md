# Channels and interaction

A channel adapter translates a caller's request into an operation on the instance. Every adapter uses the catalog's operation identifiers and schemas. The runtime receives the trusted execution context separately from the operation input and applies the same validation and authorization regardless of the channel.

## Schemas

The contracts package uses Zod schemas and exports JSON Schema 2020-12. Wire values are plain JSON. Numbers must be finite, objects must have plain properties, and optional fields are omitted. `undefined` is not a wire value.

Schemas cannot coerce values or supply defaults during validation. Transforms and custom refinements are also refused. Validation rejects a parse that strips or changes submitted data. Use strict object schemas and perform application normalization in the handler. Protected output fields must permit absence so a policy-projected result still validates.

## Catalog

The catalog is a deterministic composition of browser-safe declarations. Constructing it does not open storage or load server handlers. It records the schemas and permissions for each operation with its dependencies and channel metadata. Declared workflows are part of the catalog.

Composition rejects duplicate operation identifiers and missing module dependencies. It also checks dependency cycles, UI declarations, workflow references and MCP-name collisions. Handlers register against the exact capability declarations. Typed invocation derives from those declarations; channel adapters use the raw entrypoints to invoke an identifier received at runtime.

Operation identifiers remain unchanged across channels. MCP tool names replace dots and hyphens with underscores and have a maximum length of 64 characters. Discovery identifies operations outside the caller's grant as denied, but each invocation still checks access. `GET /api/v1/contract` returns the application identifier and contract version with an application digest. Each operation includes its `schemaDigest`, computed by `operationSchemaDigest`.

### Display metadata

Display metadata specifies how an operation and the records it returns are presented. It declares the record kind and key with a title field and the shown fields. For a list response it describes the records in `items`. Collection reads derive this metadata from the collection declaration.

A shown field can declare a label and kind. Supported kinds are `text`, `date`, `date-time`, `status`, `reference` and `file`. Status fields can map values to the tones `neutral`, `positive`, `warning` and `negative`. A reference identifies the resource kind it names. Catalog validation checks that selected fields exist in the output record and rejects invalid kinds or combinations. Labels must fit on one line and fields cannot repeat.

Generated record screens use the metadata to choose titles and render fields. `screens.resources` supplies navigation for a resource reference. Form controls use field metadata as well. The collection screen's CSV export and CLI `--output csv` derive columns from it. MCP puts the label in the tool title and describes the returned record fields. An operation without display metadata uses its schema's default presentation.

## HTTP

The HTTP adapter exposes commands at `POST /api/v1/commands/<id>` and queries at `POST /api/v1/queries/<id>`. A browser session uses a cookie after launch-link sign-in. A process presents a bearer credential. The adapter checks Host and Origin headers and refuses cross-origin browser writes.

A peer call on behalf of a mapped person cannot use the launch or event routes. Its access is limited to authorized operations. The peer assertion does not issue a local browser session.

`GET /api/v1/events` follows authorized changes. The adapter encrypts each cursor and binds it to the session. A restart changes the cursor key, requiring the client to obtain a fresh snapshot. Before each pull the adapter rechecks the session. It authorizes the next batch and enqueues it within the storage read boundary; a permission change cannot commit between that check and enqueueing. A replacement adapter must preserve this delivery boundary.

## MCP

The stdio MCP bridge exposes each capability as a tool. Command calls require an idempotency key and can supply expected revisions with their input. Tool arguments cannot set the trusted execution context. The bridge reports a failure as a tool error containing the shared error envelope.

In attached mode the bridge reads the connection file and calls the host over loopback HTTP. `bun run cli mcp --embedded` opens the instance within the bridge process. A configured grant file narrows that embedded caller's access. Internal journal positions can be used directly in embedded mode because there is no HTTP session cursor.

## Command line

The CLI derives its subcommands and typed input flags from the catalog. `bun run build:cli` compiles a standalone binary to `dist/bin/<name>`. The compiled binary does not require Bun.

`--json` supplies the whole operation input as a JSON object. `--dry-run` validates the command input without executing the operation. Output is JSON by default. `--output text` presents a table, and `--output csv` exports supported record lists using their display metadata.

The discovery commands `help`, `list`, `schema` and `workflows` work without an open instance. Host commands manage workspace execution. `serve` starts a host, `mcp` starts its bridge, `sync` pulls an inbound batch, and `drain` attempts outbound delivery until no progress remains. `backup`, `restore` and `migrate` operate local workspace storage.

An orchestrator that uses the compiled CLI in a temporary sandbox must retain that workspace while `drain` reports unresolved delivery. `bun run test:sandbox` checks the compiled binary's execution path.

### Exit codes

| Exit | Error or operation | Meaning |
| --- | --- | --- |
| 0 | Successful operation | Completed |
| 1 | `INTERNAL`, `INVALID_OUTPUT` | Internal failure; also unverified release status, failed driver check or lost workspace lease |
| 2 | `INVALID_INPUT` | Invalid input or usage; also policy-check and network-export errors |
| 3 | `NOT_FOUND` | Requested resource does not exist |
| 4 | `FORBIDDEN` | Access refused |
| 5 | `CONFLICT` | Conflicting state or workspace ownership |
| 6 | `IDEMPOTENCY_CONFLICT` | Key reused with a different fingerprint |
| 7 | `CANCELLED` | Execution cancelled |
| 8 | `UNAVAILABLE` | Required dependency unavailable |
| 10 | Audit verification or compliance report | Damaged audit chain or failing compliance result |
| 75 | Drain or waiting run | Unresolved effects, or a run waiting for a response |

## UI bindings

A capability declares its UI binding or an exception explaining why no screen exposes it. Catalog validation checks that declaration. `unboundOperations` separately identifies bound capabilities that no screen references.

The React capability form validates against the capability schema and retains its idempotency key across retries until the command commits. A declared binding does not by itself prove that the screen implements the operation correctly; the screen needs its own behavioral verification.

## UI session context

A screen can register the selected resource identifiers and their observed revisions. The host checks that the caller can read each resource and that an observed revision is not ahead of the instance. A run started from that UI session captures the checked context. Subsequent selection changes do not alter that run's context.

## UI intents

A run with captured UI context can request an action on that session through these run tools:

| Tool | Intent | Effect on the screen |
| --- | --- | --- |
| `ui.open` | `openResource` | Navigate to the route registered for the resource kind |
| `ui.select` | `selectResource` | Select a resource supported by the current screen |
| `ui.prepare` | `prepare` | Fill a bound command form for the person to submit |
| `ui.request-review` | `requestReview` | Show a review containing the named operations and resources |

The UI session store requires the run's principal and workspace to match the session. It rejects cancelled runs and expired sessions. The run must be able to read the named resources, and their kinds must be selectable. A review can name only registered operations. A prepared form must bind to a command.

An intent changes no workspace records and creates no journal entry. The screen polls through `useUiSession` and resolves the intent as accepted, rejected or expired. Values supplied to a prepared form remain untrusted; submission validates and authorizes the command normally.

The default handler stores prepared values for the bound `CapabilityForm`, which displays a notice. A screen with a separate form route supplies a `prepare` handler. That handler receives the intent identifier, stores its values with `holdRunPrefill` and navigates to the form. Run identifiers on intents let a review identify the run that requested it.

## Results

| Operation kind | Result envelope |
| --- | --- |
| Command | `operation`, `result`, `cursor`, `authorizationRevision`, changed `revisions`, and `effects` when present |
| Query | `data`, `cursor`, `authorizationRevision` |

A channel maps `ApplicationError` into the shared envelope containing its code and safe message with optional details. Unexpected exceptions produce a generic internal error. The exit-code table gives the command-line mapping for the shared error codes; HTTP uses corresponding status codes.

## Versions and idempotency

The contract version defaults to `1.0.0`. A breaking input or output change requires a version change with a migration note for callers.

An idempotency key is scoped to a workspace and principal. Its fingerprint includes the contract version and operation identifier with validated input, expected revisions and the run/grant context. Reusing the key with a different fingerprint returns `IDEMPOTENCY_CONFLICT`. A replay rechecks current authorization and projects the stored result under current field policy without executing the handler.

For a peer call on behalf of a mapped person, `ExecutionContext.peer.subject` scopes the result to the peer and adds the mapped principal to the fingerprint. A retry after the subject mapping changes conflicts.

HTTP and MCP require a key for a command. The CLI generates one when it is omitted, while a direct invocation may omit it. Replay depends on the stored result remaining within retention, as described in [Operations and state](capability-authoring.md#snapshots-and-storage).

## Generated reference

From the repository root, `bun run generate` writes the catalog-derived reference to `dist/reference/<id>/`. It includes the OpenAPI document and operation reference with workflow and security artifacts. These files remain outside version control. Generation validates the catalog's ability to produce its reference; it does not establish the behavior of a running provider or device.

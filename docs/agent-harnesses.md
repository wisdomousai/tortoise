# Agent harnesses

`packages/agents` exposes `Harness`, `HarnessTurn`, `ToolPort`, `RunStore` and `createRunSupervisor`. The public contracts contain no vendor SDK types. Each adapter translates native lifecycle events into text/progress/tool events; domain changes remain command receipts and change-journal entries.

The supervisor serializes turns by conversation ID while independent runs may execute concurrently. It records queued, running, awaiting-question, awaiting-approval, succeeded, failed, cancelled and interrupted states. Output is bounded and known credential formats are redacted. A terminal provider result is required for success. Partial text followed by a provider failure remains a failed run.

The host stores run snapshots in a separate SQLite database. On startup, unsettled runs become interrupted. Recovery is explicit: the host never silently repeats a model turn or a completed command. Resume identifiers are provider-specific; they are not a portable conversation format.

## Application tools

The service derives tools from the catalog. Provider tool inputs wrap domain `input` plus optional `expectedRevisions`. A tool callback supplies a stable call identifier; the host prefixes it with the run ID for a receipt key. The host captures principal, workspace and delegation at run creation and derives execution context itself. Tool arguments cannot replace that context.

Every tool executes through `invokeRaw` or `queryRaw`. The runtime validates schemas, rechecks current authorization and cancellation, then commits. The initiating grant remains an upper bound even if the principal has broader permissions. Run history and controls require the same grant; the reference rejects nested run delegation. Historical free-form output is suppressed after an authorization-generation change because it cannot be field-projected safely. Capture resource IDs and observed revisions from a UI session when an action refers to a selection.

Cancellation aborts the active signal and adapter work. The transaction boundary checks that signal before commit. Already committed commands remain committed. A question or approval response resolves only the matching pending request; approval does not create additional authorization.

## Adapters

| Adapter       | Execution                                                           | Credential boundary                                     |
| ------------- | ------------------------------------------------------------------- | ------------------------------------------------------- |
| Deterministic | Declarative JSON command script                                     | None; acceptance fixture, not a language model          |
| Codex         | Bundled native app-server over stdio JSON-RPC                       | Explicit host-selected environment; isolated home       |
| Claude        | Agent SDK with explicit native executable and application MCP tools | Explicit API key; ambient settings/credentials excluded |
| AI SDK        | Tool loop with an injected language model                           | Explicit provider configuration; separate funding path  |

The default task profile exposes application tools and denies shell/filesystem approval. A process under the same OS user is not a security sandbox: use a stronger host isolation adapter when running untrusted executable code. Credentials and process APIs remain outside browser imports.

See [provider integration](providers.md) for current login/funding limits and [desktop packaging](desktop-packaging.md) for native resource resolution. Protocol fixtures and actual provider calls are separate evidence categories.

## Background jobs

Jobs are ordinary clients with a trusted scoped identity and grant. `scripts/job.ts` demonstrates a deterministic status transition against the running authority; it reads current task revisions and submits commands with stable keys. Schedulers, retries and queues can be replaced independently of domain handlers. A job must not write the SQLite snapshot directly.

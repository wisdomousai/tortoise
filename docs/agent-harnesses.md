# Agent harnesses

An agent harness runs a model turn and lets it call the application's tools. The harness contracts in `packages/agents` contain no vendor SDK types. Each adapter turns its provider's native events into text, progress and tool events, and domain changes still arrive only as command receipts and journal entries.

## Runs

The supervisor serializes turns within one conversation and runs independent conversations concurrently. A run is queued, running, awaiting a question or approval, succeeded, failed, cancelled or interrupted. Success needs a terminal result from the provider, so partial text followed by a provider failure is a failed run.

Output is bounded, and known credential formats are redacted, including a secret split across streamed chunks. Redaction is a safety net; it is no reason to let credentials reach a run.

Run snapshots live in their own database. At startup, unsettled runs become interrupted, and the host never silently repeats a model turn or a committed command. Resume identifiers are provider-specific, not a portable conversation format.

## Application tools

Tools are derived from the catalog. A tool call carries domain input and optional expected revisions. The host turns the provider's call identifier into an idempotency key scoped to the run. Principal, workspace and grant are captured when the run is created, and tool arguments cannot replace them.

Every tool call goes through the runtime like any other caller. It validates input, rechecks current authorization and cancellation, and commits. The initiating grant stays the upper bound even when the principal could do more, and runs cannot delegate further. When authorization changes, earlier free-form output is hidden, because it cannot be field-projected. When an action refers to a selection, the run captures the resource IDs and revisions from the UI session instead of following later selection changes.

Cancellation aborts the active work and is checked before commit. Commands that already committed stay committed. An answer to a question or approval resolves only the matching request, and approval never adds authorization.

## Adapters

| Adapter       | Execution                                      | Credential boundary                                         |
| ------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| Deterministic | A declarative command script                   | None; an acceptance fixture, not a model                    |
| Codex         | The bundled app-server over stdio JSON-RPC     | Environment chosen by the host; isolated home directory     |
| Claude        | The Agent SDK with the application's MCP tools | Explicit API key; ambient settings and credentials excluded |
| AI SDK        | A tool loop over an injected model             | Explicit provider configuration                             |
| Local         | The AI SDK tool loop on a loopback model       | None; reaches only the `local-inference` destination        |

The default profile exposes application tools and denies shell and file approvals. A process running as the same OS user is not a sandbox, so code that is not trusted needs a stronger isolation adapter. Credentials and process APIs never reach browser code.

A harness that composes other CLIs and MCP servers needs an enforced execution boundary and a broker that keeps upstream credentials outside it. That layer is not implemented. The application binary already supplies the tool side: an embedded MCP server under a launcher-written grant, and generated CLI subcommands with mapped exit codes ([system-of-record pattern](system-of-record-pattern.md)).

See [providers](providers.md) for login and funding, and [desktop](desktop.md#packaged-resources) for native resources. Protocol fixtures and real provider calls count as separate evidence.

## Background jobs

A job is an ordinary caller with a scoped identity and grant. It reads current revisions and submits commands with stable keys. The `project-tasks` example includes one. Schedulers, retries and queues can change without touching handlers. A job never writes storage directly.

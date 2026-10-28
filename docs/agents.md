# Agents

Agents act on an application's records through agent runs, with the same capabilities, validation and authorization as people. A harness executes each run.

## Concepts

Terms: [harness](glossary.md#harness), [agent run](glossary.md#agent-run), [agent definition](glossary.md#agent-definition), [approval request](glossary.md#approval-request), [assignment](glossary.md#assignment), [trigger](glossary.md#trigger), [trigger grant](glossary.md#trigger-grant) and [model entry](glossary.md#model-entry).

## Harnesses

A harness runs a model turn and lets the model call the application's tools. The harness contracts in `packages/agents` contain no vendor SDK types. Each adapter turns its provider's native events into text, progress and tool events. Domain changes are still recorded only as command [receipts](glossary.md#receipt) and [journal](glossary.md#journal) entries.

| Adapter       | Execution                                      | Credential boundary                                         |
| ------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| Deterministic | A declarative command script                   | None; an acceptance fixture without a model                 |
| Codex         | The bundled app-server over stdio JSON-RPC     | Environment chosen by the host; isolated home directory     |
| Claude        | The Agent SDK with the application's MCP tools | Explicit API key; ambient settings and credentials excluded |
| AI SDK        | A tool loop over an injected model             | Explicit provider configuration                             |
| Local         | The AI SDK tool loop on a loopback model       | None; reaches only the `local-inference` destination        |

The default profile exposes application tools and declines shell and file approvals. A process running as the same OS user is not a sandbox, so code that is not trusted needs a stronger isolation adapter. Credentials and process APIs never reach browser code.

Harness processes start directly instead of through the [process port](glossary.md#process-port). `scripts/boundary-rules.ts` lists the launchers in `packages/agents` as reviewed exemptions, and the host passes them the egress proxy environment.

A harness that composes other CLIs and MCP servers needs an enforced execution boundary and a broker that keeps upstream credentials outside it. On Linux, the [execution host](glossary.md#execution-host) is that boundary, and its [README](../plugins/execution-host/README.md) describes the sandbox. A task runs in a bubblewrap sandbox and reaches the application CLI or MCP server through a token bound to the run's grant. It reaches providers only through the egress proxy. No harness launches its tools through it yet, and macOS and Windows have no backend.

The application binary supplies the tool side: an embedded MCP server under a launcher-written [grant file](glossary.md#grant-file), and generated CLI subcommands with mapped exit codes ([systems of record](systems-of-record.md#command-line)).

## Runs

The host's run route starts a run for the person whose session calls it. With `agentId`, the run executes under that agent definition: its grant is narrowed by `agentGrant` to the definition and the selection the run started on, its prompt starts with `agentInstructions`, and the definition's budgets and model requirement apply. Without `harnessId`, the host picks the first harness it was given, by the embedding process or a plugin such as the [model server](../plugins/model-server/README.md), that meets the requirement. With `conversationId`, the run continues a conversation of the caller's own runs under the same agent. The run supervisor executes runs that share a conversation ID one after another, and other runs concurrently. A harness without native resume keeps no history between them, so the screen sends the earlier turns it shows with the follow-up. A run is queued, running, awaiting a question, awaiting approval, succeeded, failed, cancelled or interrupted. Success needs a terminal result from the provider. Partial text followed by a provider failure is a failed run.

Output is bounded, and known credential formats are redacted, including a secret split across streamed chunks. Streamed text is recorded in pieces of at least 200 characters, so a long reply keeps its beginning within the 256 events a run retains. A `tool-finish` event names the records a command changed (`resources`, from its receipt) or the error code of a refusal (`code`), so a run view can link each call to its record.

The host keeps run snapshots in a separate SQLite database, `runs.sqlite`, in the workspace directory. At startup, runs that had not completed become interrupted. The host never silently repeats a model turn or a committed command. Resume identifiers are provider-specific and are not a portable conversation format. The host appends each run's start and end to the [audit log](glossary.md#audit-log), without its prompt or output.

## Application tools

Tools are derived from the [catalog](glossary.md#catalog), one per [capability](glossary.md#capability). A tool call includes domain input and, for a command, optional expected [revisions](glossary.md#revision). The host turns the provider's call ID into an [idempotency key](glossary.md#idempotency-key) scoped to the run. The run captures the [principal](glossary.md#principal), workspace and grant when it is created, and tool arguments cannot replace them.

Every tool call goes through the [instance](glossary.md#instance) like any other [caller](glossary.md#caller). The instance validates input, rechecks current authorization and cancellation, and commits. The initiating grant stays the upper bound even when the principal could do more. A run cannot start another run, so runs cannot delegate further.

When the authorization revision changes, the host hides the run's earlier free-form output, because model text cannot be field-projected. A run started from a selection captures the resource IDs and revisions from the [UI session context](glossary.md#ui-session-context). Later selection changes do not retarget it. Such a run also gets the `ui.open`, `ui.select`, `ui.prepare` and `ui.request-review` tools, which send [UI intents](glossary.md#ui-intent) to that screen only. On the AI SDK and local harnesses it also gets an `ask_person` tool: the model asks the person a question, with optional choices, and the run waits in `awaiting-question` for the answer. A run without a screen, such as a trigger's, gets neither. A run under an agent definition sees only the tools its grant lists.

Cancellation aborts the active work and is checked before commit. Commands that already committed stay committed. An answer to a question or approval resolves only the matching request.

## Agent definitions

A [module](glossary.md#module) declares an agent definition with `defineAgent`, and building the catalog checks it. A direct agent runs its commands itself, so each of those commands needs a [UI binding](glossary.md#ui-binding). A requesting agent runs its queries and submits its commands as approval requests. A direct agent's `requests` lists commands it submits as approval requests instead, such as a cancellation, or a command it runs itself whose policy refuses it some input, such as a discount above its limit. Its grant then adds `approval.request`, and `agentInstructions` lists those commands with their input schemas. Budgets set model turns, tool calls and wall time per run. The supervisor fails a run with `BUDGET_EXCEEDED` instead of exceeding the tool-call or wall-time budget.

A run under a definition acts under a [delegated grant](glossary.md#grant) that `agentGrant` in `packages/runtime` narrows from its issuer's. It lists the definition's capabilities within the issuer's grant, with approval request submission in place of a requesting agent's commands. A definition that names resource types limits the grant to the run's starting records of those types, such as a person's selection. The grant expires at the earlier of the issuer's expiry and the wall-time budget, and is bound to the issuer and the run. Policy still authorizes every call (`packages/runtime/test/agent-grant.test.ts`).

## Approval requests

An approval request lets an agent ask for a command it may not run itself. `approvalFeature` in `packages/runtime` implements the approval request capabilities as the `approval` [feature](glossary.md#feature), with approval requests in its own state slice. The application mounts it with an `ApprovalAccess` view that decides who may request, approve, reject, expire and read approval requests about a record, and that applies the application's membership gate, integration allowlists and grant scope:

| Capability                      | Usual caller           | What it does                                                    |
| ------------------------------- | ---------------------- | --------------------------------------------------------------- |
| `approval.request`              | A requesting agent run | Records a command, its input, a rationale and revisions read    |
| `approval.approve`              | A person               | Runs the command as the approver, in the same transaction       |
| `approval.reject`               | A person               | Closes the approval request with an optional reason             |
| `approval.expire`               | A job                  | Closes an approval request past its expiry, 24 hours by default |
| `approval.list`, `approval.get` | Anyone who may see it  | Reads approval requests, filtered by visibility before paging   |

Submission refuses an unknown command, input its schema rejects, a request for an approval operation, for a run under a requesting agent definition, a command the definition does not name, and input the application's `request` hook refuses, such as a record that does not exist. The requester's principal and run ID come from the [execution context](glossary.md#execution-context), never from the input. A model name the requester states is its own label; the run's recorded model is the trusted one. A resource-scoped run requests approval only for the records it started on ([authorization](authorization.md#delegation-and-replay)).

Approving marks the approval request approved and continues with its command as a [continuation](glossary.md#continuation) under the approver's context. The command's grant check, [policy](glossary.md#policy) and commit recheck apply to the approver. The revisions the requester read act as expected revisions, so a record changed since then conflicts. A refusal or a conflict rolls the approval back and leaves the approval request pending. A requesting agent's grant leaves the command out, so it cannot approve its own approval request. The feature's policy refuses approve and reject to any delegated caller (`packages/runtime/test/approval.test.ts`, `packages/runtime/test/approval-feature.test.ts`).

The web frame's `approval-review` [UI registry](glossary.md#ui-registry) item lists pending approval requests live with Approve and Reject. A refusal or conflict shows on the approval request, which stays pending. The operator registry's attention queue shows an approval request with the same choices.

## Assignments to agents

An [assignment](glossary.md#assignment) can name an agent definition as its [assignee](glossary.md#assignee). Sending it writes a journal entry whose event type names the definition, and a trigger on that event type starts the run. `agentGrant` records the definition on the run's grant, and the `assignment` feature matches the assignee against it. A definition limited to the assignment resource type reads only the assignment that started it. Its `creates` field lets the run create report resources, which a resource-scoped grant would otherwise refuse.

The run reads the brief, records its reports and marks the assignment done. A person accepts or discards each report, because the feature refuses accepting to any delegated caller.

## Triggers and their grants

[`plugins/automation`](../plugins/automation/README.md) runs work without a person at the screen. A trigger starts an agent definition or a deterministic job on a committed change or on a schedule. Triggers are declared in code with `defineTrigger`, never at run time, and checked when the plugin opens. The check refuses unknown capabilities, jobs or agents, a schedule under one minute, and a run that would start its own trigger again.

A trigger does nothing until a person enables the trigger by issuing a trigger grant. A person issues, renews or revokes only the trigger grant of that principal. A grant lasts from one minute to 90 days. Issuing replaces any other active grant for the trigger, so one event never starts two runs. Revoking a grant stops future runs, and a run in progress finishes within its budget.

Each pass of the trigger loop visits every trigger with an active grant. An event trigger reads the journal after its cursor as the issuer, narrowed to the capabilities it reacts to. A schedule trigger checks whether a new slot began. The loop starts one run per matching event or slot and records progress before the next, so a failed run is recorded and never retried. An idle loop writes nothing.

A trigger run acts as the grant's issuer under a delegated grant that lists the trigger's capabilities, narrowed again by `agentGrant` for an agent. That grant expires at the earlier of the trigger grant's expiry and the run's wall-time budget. Policy authorizes every call as the issuer, so a role the issuer lost since issuing is refused. The refusal becomes an open failure that only the issuer sees and resolves (`plugins/automation/test/automation.test.ts`).

A job's command keys come from the run, the capability, its input and how often the run made that call. A job repeated after a crash therefore replays what it already committed. An agent's keys are its model's tool-call IDs, which change across a repeat. Give event triggers to requesting agents, whose repeat adds at most a second approval request.

Trigger runs go through the plugin's own run supervisor, so they do not appear in the host's run panel. An agent run takes the first available harness that meets the agent's model requirement, and fails when none does. Its model sees only the capabilities agent triggers may call. The prompt starts with the definition's instructions and, for a requesting agent, each command it may request approval for with its input schema. `winding-line` composes the plugin with a schedule trigger that closes approval requests nobody approved in time.

## Local models

A model entry names a base model, an optional LoRA or merged fine-tune and the dataset it was tuned on, each by digest, with the weights' license and context size. An agent that names model entries runs only on a harness serving one of them. An entry that names agents serves only those, so a fine-tune made for one task is never picked for another. The agent's model requirement decides which harnesses may run it at all ([providers](providers.md#local-models)).

The [model server plugin](../plugins/model-server/README.md) hashes the weights before every start and starts llama.cpp `llama-server` or vLLM through the process port. It refuses files that differ from the entry, and a fine-tune without a passing activation for its exact digests. Its harness records the measured digests on each run as verified. A server run outside the host is recorded as unverified, with the digests the deployment configured. An approval request therefore leads through its run to the base weights, the adapter and the dataset.

Fine-tuning happens outside the host. Its input is an [approval dataset](glossary.md#approval-dataset) from `exportApprovalDataset` in `packages/runtime`. The export holds only the approved, rejected and expired approval requests the exporting caller may see. Redaction blanks named input fields, and optionally the rationale and rejection reason, before the digest is taken. The fine-tune's entry names its dataset by that digest.

The fine-tune becomes a new entry. It serves only after `gateModel` in `packages/testing` has run the agents' scenarios on it, compared it with the model it replaces, and passed. The gate passes only when the candidate passes every scenario.

## Evaluation

An [agent scenario](glossary.md#agent-scenario) gives an agent definition a task and fixture state. It checks what the run committed and what it requested approval for: the receipts, the approval requests and the refusals, never the text. A scenario's `answers` reply to the run's questions in order, and `expect.questions` counts them. The same scenario runs on the deterministic harness in CI. It runs on a configured model only when a test is given one and `AGENT_SCENARIOS=live` is set. `scenarioRegressions` lists what a candidate model fails that the current one passes.

## Background jobs

A background job is an ordinary caller with a scoped identity and grant. It reads current revisions and submits commands with stable idempotency keys. A job never writes storage directly.

## Use

Add a requesting agent definition to an application made by the [scaffold](glossary.md#scaffold). The first agent also mounts the `approval` [feature](glossary.md#feature) with an access view from the workspace roles, and adds a screen of pending approval requests.

```sh
bun run scaffold add agent <name> --collection <type>
```

Run the deterministic tests:

```sh
bun run test:harness
bun test plugins/automation
bun test plugins/model-server
bun test showcase/examples/<app>/test/<name>-agent.test.ts
```

Run the scenarios against a configured model, or the model server against real weights:

```sh
AGENT_SCENARIOS=live bun test showcase/examples/<app>/test/<name>-agent.test.ts
LOCAL_MODEL_GGUF=~/models/gemma-4-E4B-it-Q4_0.gguf bun test plugins/model-server/test/live.test.ts
```

## Limits

- The AI SDK and local harnesses keep no history between the runs of a conversation; the earlier turns reach the model only as text the screen sends.
- The host keeps no prompts, so a screen that shows a conversation after a reload has the replies and calls but not what the person typed.

## References

- [Providers](providers.md)
- [Assignments](assignments.md)
- [Authorization](authorization.md)
- [Security and compliance](security-and-compliance.md)
- [State and reactivity](state-and-reactivity.md)
- [Interaction contract](interaction-contract.md#ui-intents)
- [Implementation status](implementation-status.md)
- [Desktop](desktop.md#packaged-resources)
- [Testing package: agent scenarios](../packages/testing/README.md#agent-scenarios)
- [add-capability skill](../packages/runtime/skills/add-capability/SKILL.md)
- [serve-a-local-model skill](../plugins/model-server/skills/serve-a-local-model/SKILL.md)
- [run-agent-tools-in-a-sandbox skill](../plugins/execution-host/skills/run-agent-tools-in-a-sandbox/SKILL.md)
- [`showcase/examples/field-service/job.ts`](../showcase/examples/field-service/job.ts)

# Agents

This page explains how agents act on an application: harnesses and agent runs, the tools a run calls, agent definitions, proposals, triggers and standing grants, local models and evaluation. It is for integrators who let a model or an unattended job work on an application's records. [Providers](providers.md) covers provider accounts, funding and the local harness.

## Concepts

This page is the home for [harness](glossary.md#harness), [agent run](glossary.md#agent-run), [agent definition](glossary.md#agent-definition), [proposal](glossary.md#proposal), [trigger](glossary.md#trigger), [standing grant](glossary.md#standing-grant) and [model entry](glossary.md#model-entry).

## Harnesses

A harness runs a model turn and lets the model call the application's tools. The harness contracts in `packages/agents` contain no vendor SDK types. Each adapter turns its provider's native events into text, progress and tool events. Domain changes still arrive only as command [receipts](glossary.md#receipt) and [journal](glossary.md#journal) entries.

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

The application binary supplies the tool side: an embedded MCP server under a launcher-written [grant file](glossary.md#grant-file), and generated CLI subcommands with mapped exit codes ([systems of record](systems-of-record.md#command-line)). [Desktop](desktop.md#packaged-resources) covers native resources. Protocol fixtures and real provider calls count as separate evidence.

## Runs

The run supervisor executes runs that share a conversation ID one after another, and other runs concurrently. A run is queued, running, awaiting a question, awaiting approval, succeeded, failed, cancelled or interrupted. Success needs a terminal result from the provider. Partial text followed by a provider failure is a failed run.

Output is bounded, and known credential formats are redacted, including a secret split across streamed chunks. Redaction is a safety net: keep credentials away from runs in the first place.

The host keeps run snapshots in their own SQLite database, `runs.sqlite` in the workspace directory. At startup, runs that had not settled become interrupted. The host never silently repeats a model turn or a committed command. Resume identifiers are provider-specific and are not a portable conversation format. The host appends each run's start and end to the [audit log](glossary.md#audit-log), without its prompt or output.

## Application tools

Tools are derived from the [catalog](glossary.md#catalog), one per [capability](glossary.md#capability). A tool call carries domain input and, for a command, optional expected [revisions](glossary.md#revision). The host turns the provider's call ID into an [idempotency key](glossary.md#idempotency-key) scoped to the run. The run captures the [principal](glossary.md#principal), workspace and grant when it is created, and tool arguments cannot replace them.

Every tool call goes through the [authority](glossary.md#authority) like any other [caller](glossary.md#caller). The authority validates input, rechecks current authorization and cancellation, and commits. The initiating grant stays the upper bound even when the principal could do more. A run cannot start another run, so runs cannot delegate further.

When the authorization revision changes, the host hides the run's earlier free-form output, because model text cannot be field-projected. A run started from a selection captures the resource IDs and revisions from the [UI session context](glossary.md#ui-session-context). Later selection changes do not retarget it.

Cancellation aborts the active work and is checked before commit. Commands that already committed stay committed. An answer to a question or approval resolves only the matching request. Approval never adds authorization.

## Agent definitions

A [module](glossary.md#module) declares an agent definition with `defineAgent`, and building the catalog checks it. A direct agent runs its commands itself, so each of those commands needs a [UI binding](glossary.md#ui-binding). A proposing agent runs its queries and submits its commands as proposals. Budgets set model turns, tool calls and wall time per run. The supervisor fails a run with `BUDGET_EXCEEDED` instead of exceeding the tool-call or wall-time budget.

A run under a definition acts under a [delegated grant](glossary.md#grant) that `agentGrant` in `packages/runtime` narrows from its issuer's. It lists the definition's capabilities within the issuer's grant, with proposal submission in place of a proposing agent's commands. A definition that names resource types limits the grant to the run's starting records of those types, such as a person's selection. The grant expires at the earlier of the issuer's expiry and the wall-time budget, and is bound to the issuer and the run. Policy still authorizes every call (`packages/runtime/test/agent-grant.test.ts`).

## Proposals

A proposal lets an agent ask for a command it may not run itself. `proposalHandlers` in `packages/runtime` implements the proposal capabilities over a collection in the application's state:

| Capability                      | Usual caller          | What it does                                                 |
| ------------------------------- | --------------------- | ------------------------------------------------------------ |
| `proposal.submit`               | A proposing agent run | Records a command, its input, a rationale and revisions read |
| `proposal.accept`               | A person              | Runs the command as the accepter, in the same transaction    |
| `proposal.reject`               | A person              | Closes the proposal with an optional reason                  |
| `proposal.expire`               | A job                 | Closes a proposal past its expiry, 24 hours by default       |
| `proposal.list`, `proposal.get` | Anyone who may see it | Reads proposals, filtered by visibility before paging        |

Submission refuses an unknown command, input its schema rejects, and a proposal of a proposal. The proposer's principal and run ID come from the [execution context](glossary.md#execution-context), never from the input. A model name the proposer states is its own label; the run's recorded model is the trusted one. A resource-scoped run proposes only for the records it started on ([authorization](authorization.md#delegation-and-replay)).

Accepting marks the proposal accepted and continues with its command as a [continuation](glossary.md#continuation) under the accepter's context. The command's grant check, [policy](glossary.md#policy) and commit recheck apply to the accepter. The revisions the proposer read act as expected revisions, so a record changed since then conflicts. A refusal or a conflict rolls the acceptance back and leaves the proposal open. A proposing agent's grant leaves the command out, so it cannot accept its own proposal (`packages/runtime/test/proposal.test.ts`).

The web frame's `proposal-review` [UI registry](glossary.md#ui-registry) item lists open proposals live with Accept and Reject. A refusal or conflict shows on the proposal, which stays open. The operator registry's attention queue shows a proposal with the same choices.

## Triggers and standing grants

[`plugins/automation`](../plugins/automation/README.md) runs work without a person at the screen. A trigger starts an agent definition or a deterministic job on a committed change or on a schedule. Triggers are declared in code with `defineTrigger`, never at run time, and checked when the plugin opens. The check refuses unknown capabilities, jobs or agents, a schedule under one minute, and a run that would start its own trigger again.

A trigger does nothing until a person enables it by issuing a standing grant. Only a person issues, renews or revokes a grant, and only their own. A grant lasts from one minute to 90 days. Issuing replaces any other active grant for the trigger, so one event never starts two runs. Revoking a grant stops future runs, and a run in progress finishes within its budget.

Each pass of the trigger loop visits every trigger with an active grant. An event trigger reads the journal after its cursor as the issuer, narrowed to the capabilities it reacts to. A schedule trigger checks whether a new slot began. The loop starts one run per matching event or slot and records progress before the next, so a failed run is recorded and never retried. An idle loop writes nothing.

A trigger run acts as the grant's issuer under a delegated grant that lists the trigger's capabilities, narrowed again by `agentGrant` for an agent. That grant expires at the earlier of the standing grant's expiry and the run's wall-time budget. Policy authorizes every call as the issuer, so a role the issuer lost since issuing is refused. The refusal becomes an open failure that only the issuer sees and resolves (`plugins/automation/test/automation.test.ts`).

A job's command keys come from the run, the capability, its input and how often the run made that call. A job repeated after a crash therefore replays what it already committed. An agent's keys are its model's tool-call IDs, which change across a repeat. Give event triggers to proposing agents, whose repeat adds at most a second proposal.

Trigger runs go through the plugin's own run supervisor, so they do not appear in the host's run panel. An agent run takes the first available harness that meets the agent's model requirement, and fails when none does. Its model sees only the capabilities agent triggers may call. The prompt starts with the definition's instructions and, for a proposing agent, each command it may propose with its input schema. `line-station` composes the plugin with a schedule trigger that closes proposals nobody accepted in time.

## Local models

A model entry names a base model, an optional LoRA or merged fine-tune and the dataset it was tuned on, each by digest, with the weights' license and context size. An agent that names model entries runs only on a harness serving one of them. An entry that names agents serves only those, so a fine-tune made for one task is never picked for another. The agent's model requirement decides which harnesses may run it at all ([providers](providers.md#local-models)).

The [model server plugin](../plugins/model-server/README.md) hashes the weights before every start and starts llama.cpp `llama-server` or vLLM through the process port. It refuses files that differ from the entry, and a fine-tune without a passing activation for its exact digests. Its harness records the measured digests on each run as verified. A server run outside the host is recorded as unverified, with the digests the deployment configured. A proposal therefore leads through its run to the base weights, the adapter and the dataset.

Fine-tuning happens outside the host. Its input is a [proposal dataset](glossary.md#proposal-dataset) from `exportProposalDataset` in `packages/runtime`. The export holds only the accepted, rejected and expired proposals the exporting caller may see. Redaction blanks named input fields, and optionally the rationale and rejection reason, before the digest is taken. The fine-tune's entry names its dataset by that digest.

The fine-tune becomes a new entry. It serves only after `gateModel` in `packages/testing` has run the agents' scenarios on it, compared it with the model it replaces, and passed. The gate passes only when the candidate passes every scenario.

## Evaluation

An [agent scenario](glossary.md#agent-scenario) gives an agent definition a task and fixture state. It checks what the run committed and proposed: the receipts, the proposals and the refusals, never the text. The same scenario runs on the deterministic harness in CI. It runs on a configured model only when a test is given one and `AGENT_SCENARIOS=live` is set. `scenarioRegressions` lists what a candidate model fails that the current one passes, and [`packages/testing`](../packages/testing/README.md#agent-scenarios) describes the scenario shape.

## Background jobs

A background job is an ordinary caller with a scoped identity and grant. It reads current revisions and submits commands with stable idempotency keys. `examples/project-tasks/job.ts` is one. Schedulers, retries and queues can change without touching handlers. A job never writes storage directly.

## Use

Add a proposing agent definition to an application made by the [scaffold](glossary.md#scaffold). The first agent also adds the proposal capabilities and a screen of open proposals.

```sh
bun run scaffold add agent <name> --collection <type>
```

Run the deterministic tests:

```sh
bun run test:harness
bun test plugins/automation
bun test plugins/model-server
bun test examples/<app>/test/agent-scenarios.test.ts
```

Run the scenarios against a configured model, or the model server against real weights:

```sh
AGENT_SCENARIOS=live bun test examples/<app>/test/agent-scenarios.test.ts
LOCAL_MODEL_GGUF=~/models/gemma-4-E4B-it-Q4_0.gguf bun test plugins/model-server/test/live.test.ts
```

Skills cover the steps: [add-capability](../packages/runtime/skills/add-capability/SKILL.md) for triggers, [serve-a-local-model](../plugins/model-server/skills/serve-a-local-model/SKILL.md) for model entries and the gate, and [run-agent-tools-in-a-sandbox](../plugins/execution-host/skills/run-agent-tools-in-a-sandbox/SKILL.md) for the execution host.

## Limits

No host route starts an agent run from an agent definition. Definitions run through triggers and agent scenarios.

## Related pages

- [Providers](providers.md): provider accounts, the local harness and model requirements.
- [Authorization](authorization.md): delegated grants, resource scopes and revocation.
- [Security and compliance](security-and-compliance.md): the execution host's sandbox and the audit log.
- [State and reactivity](state-and-reactivity.md): commands, continuations and cancellation.
- [Implementation status](implementation-status.md): live runs of local models and triggered agents.

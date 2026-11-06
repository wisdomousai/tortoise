# Agents

An agent run invokes the application's capabilities under a grant derived from its caller. The runtime applies the capability's normal validation and authorization to every tool call. The run supervisor manages model execution and records progress separately from workspace transactions.

## Agent definitions

`defineAgent` declares the instructions and permitted operations for a named agent. It can also restrict resource types and set a model requirement. `agentGrant` narrows the starting caller's grant to that definition and, where resource types are declared, to the records on which the run began.

The `output: 'request-approval'` mode executes queries directly and converts command calls into approval requests. A direct agent executes its permitted commands. Its `requests` declaration identifies commands it must submit for approval. Directly executed commands require UI bindings. An agent definition does not override the application's policy; a permitted operation can still be refused for its input or resource.

Budgets constrain a run's turns and tool calls with an overall wall-time limit. Exceeding a budget fails the run with `BUDGET_EXCEEDED`. The [add-capability skill](../packages/runtime/skills/add-capability/SKILL.md) describes adding a definition and its scenarios to an application.

## Runs

`POST /api/v1/runs` starts a run as the authenticated caller. `agentId` selects a definition and its narrowed grant. `harnessId` selects an execution adapter; when omitted, the host chooses an available harness satisfying the model requirement. `GET /api/v1/harnesses` reports availability. `conversationId` continues a conversation, whose runs execute serially.

Run states are `queued`, `running`, `awaiting-question`, `awaiting-approval`, `succeeded`, `failed`, `cancelled` and `interrupted`. The host stores requests and events in `.workspace/runs.sqlite`, including the responses supplied to questions. Agent instructions are added to the provider prompt; the stored request remains what the person submitted.

A provider with session resumption receives its saved resume identifier. Other harnesses receive previous requests and replies as chat history, limited to 16,000 characters with the oldest removed first. A run retains its last 256 events, so earlier events in a long run may be unavailable. The host caps output and redacts recognized secret formats, including in requests.

After restart the host marks incomplete runs interrupted and does not repeat them. Only the result of a command establishes a committed change. Run progress and provider completion do not establish that a command committed.

### Application tools

The catalog supplies the application's tools. The run fixes its principal and workspace with the grant at startup; tool input cannot widen them. A provider call identifier supplies the tool call's idempotency key. Repeated callbacks share a result, while a reused identifier with different arguments fails.

A run started from a screen can receive UI tools against its captured session. AI SDK and local harnesses also expose `ask_person` for those runs. A run cannot start another run. The [interaction contract](interaction-contract.md#ui-session-context) specifies captured context and the checks applied to UI intents.

### Assistant panel

The frame's `AssistantPanel` can be mounted as the application's aside, with `AssistantButton` opening it on compact screens. The panel selects an agent definition and starts runs from its own UI session. Screens share the records they display through `useAssistantContext`, and the person can exclude them from the next request.

The panel displays the conversation with run progress and pending questions. It also presents approval requests and reviews. It keeps the conversation identifier per agent in browser local storage so a reload can reopen it. Earlier conversations remain on the host and are available through the run commands. Harness selection follows the host configuration and the connected account.

### Runs from the command line

The `runs` command group attaches through `TORTOISE_CONNECTION` or `--connection` and uses that session. `runs start --agent <agent-id> --wait <request>` waits until the run ends or needs input. It exits with code 75 while a response is pending. `runs answer <run> <answer>` responds and waits again; `--approve` and `--decline` answer an approval question. `runs show` returns a run, `runs list --conversation <id>` reads its conversation, and `runs cancel` requests cancellation.

## Harnesses

A harness translates the supervised run into provider interaction and returns tool calls and output. The adapters supplied by the framework have different execution requirements:

| Harness | Execution | Credential requirement | Resume behavior |
| --- | --- | --- | --- |
| `deterministic` | Scripted tool calls for fixtures | None | No provider session |
| `codex` | Codex app-server over stdio | Explicitly connected ChatGPT account | Thread identifier |
| `claude` | Claude Agent SDK | Explicit Anthropic API key | Session identifier |
| `ai-sdk` | Tool loop over a configured model | Explicit provider configuration | Conversation history |
| `local` | Tool loop against a loopback server | No provider credential | Conversation history |

Harnesses disable shell and file tools by default. Codex uses a read-only sandbox with shell, edits and search disabled. Claude receives the application's MCP tools without built-ins or settings sources. The AI SDK adapter refuses string model aliases that could obtain gateway credentials from the environment.

The execution host provides a Linux bubblewrap boundary for untrusted tools, but the harnesses do not currently use it. Running a provider process as the OS user does not contain that process's access to the machine.

## Connect an account

Provider account management requires the local user without a delegated grant. The deployment policy must bind the destinations declared in `packages/agents/src/requirements.ts`. A missing binding makes the harness unavailable and records the reason it cannot start.

For Codex, the accounts screen opens browser sign-in. The host listens on a loopback callback and checks the PKCE flow, one-use state and nonce before accepting the identity token. Inference requires `resource.invoke` and `chatgpt.tokens.use.direct`; a profile without those scopes remains saved but disabled. Tokens refresh within a minute of expiry. Logout deletes local tokens and reports whether provider revocation succeeded.

For an API-key harness, the accounts screen stores the explicitly supplied key in the credential vault. A run can use the key only after the running host saves or loads it. API-key execution does not obtain ChatGPT credentials. A run fixes its profile and selected credential at startup, then rechecks that the credential remains loaded before invoking the provider.

## Credential vault

The vault uses Keychain on macOS, Credential Manager on Windows and Secret Service on Linux. Linux requires a desktop D-Bus session. Each workspace has its own namespace. A locked or unavailable store returns an error; credentials are not written to fallback files or read from an ambient environment.

Startup does not probe the keyring. An account action can therefore trigger an unlock prompt without making workspace startup depend on the vault.

## Provider processes

The bundled runtime manifest identifies the Codex and Claude executables by digest. The host verifies those executables before a run and does not resolve them from `PATH`. Each run receives a working directory, and each conversation has an owner-only home directory. The child environment is allowlisted before the configured credential is injected.

The host closes the process tree on completion or cancellation. Cleanup on Windows and Linux still requires platform smoke evidence. The [agents package](../packages/agents/README.md) documents the adapter-specific execution boundary.

## Run supervision

A successful run requires a valid provider result and completion of its outstanding tool calls. The supervisor permits only one waiting question or approval at a time, with a five-minute default timeout. A slow event subscriber receives a reset. Failure to write the run store aborts the run.

A failed run can have committed commands before it failed. Recovery must inspect their stored results before attempting further work. Cancellation aborts in-flight calls and is checked by the runtime before each commit.

## Approval requests

The application mounts `approvalFeature` with an `ApprovalAccess` view to support approval requests. `approval.request` records the requested operation and validated input with its rationale and observed revisions. Authorized readers use `approval.list` or `approval.get`.

`approval.approve` executes the requested command under the approver's identity and current policy. A changed expected revision returns `CONFLICT` and leaves the request pending. `approval.reject` closes the request with an optional reason. `approval.expire` closes an expired request; the default pending lifetime is 24 hours. Delegated agents cannot approve or reject requests.

The requesting agent's permission to ask for a command does not establish that a person can approve it. Approval executes the operation normally and can fail its current authorization or application checks.

## Assignments to agents

An assignment can name an agent definition as its assignee. Automation can start a run when the assignment event commits. The run reads the assigned instructions and submits reports through the assignment capabilities. Report acceptance remains a separately authorized action, as specified in [Assignments](assignments.md).

## Triggers and their grants

The automation plugin starts an agent or job after a committed event or on a declared schedule. A person must issue a trigger grant before it can run. The grant lasts from a minute to 90 days and limits execution to the declared operations. Current access is checked when work runs, so a person losing their role can cause later execution to fail.

Trigger runs are separate from interactive panel runs. Event-driven requesting agents can repeat a request after another event; application design must account for that repetition. [Automation](../plugins/automation/README.md) specifies trigger declarations and delivery.

## Local models

The `local` harness requires an OpenAI-compatible server on the same machine. Bind `local-inference` to its loopback origin in the deployment policy and configure a model identifier listed by the server. The harness remains unavailable while that model is absent. The network guard refuses off-host addresses for this destination.

A manually operated server can supply a model identifier and an optional digest, but the run records the digest as unverified. The model-server plugin checks the declared weights before each start and records the measured digest as verified. Its managed server backends are `llama-server` and vLLM.

A model entry identifies its base weights and any fine-tune by digest. A fine-tune can reference its approval dataset and must pass `gateModel` scenarios before serving. The application can export approved and rejected decisions with `exportApprovalDataset`. The [local-model skill](../plugins/model-server/skills/serve-a-local-model/SKILL.md) describes configuration.

An agent's model requirement is `local`, `remote` or `any`. A harness without a declaration about where prompts are processed is treated as remote. The accounts panel does not offer the local harness; a run without an explicit harness can use the model server's configured harness.

## Evaluation

An agent scenario supplies a task and fixture state with expected command results and approval requests. It checks refused operations as well. The deterministic harness executes the scenario's script and establishes the tested tool boundary. It does not establish how a model will interpret the task.

`scenarioHarness()` switches to a real loopback OpenAI-compatible server when `AGENT_SCENARIOS=live` is explicitly configured with its URL and model. It sends no key, and `scenarioTimeout()` allows a live scenario 15 minutes. This execution needs separately configured model weights. Preserve its actual outcomes as live evidence.

From the repository root, `bun run test:harness` runs adapter fixtures. `bun test packages/host/test/providers.test.ts` checks account connection against local fixtures. The generic OIDC connection is used only by tests. A provider live smoke run requires an explicitly configured secure environment and `AGENT_LIVE_ALLOWED=1`; it performs a synthetic request and read-only tool call. Provider configuration must never be discovered from unrelated user settings.

Known execution gaps are recorded in [Implementation status](implementation-status.md#agents-and-providers).

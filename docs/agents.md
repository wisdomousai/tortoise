# Agents

An agent is one more caller. It calls the same commands and queries as a person, through the same validation and authorization, inside an agent run.

## Add an agent to your app

In an app made by the scaffold:

```sh
bun run scaffold add agent triage --collection inspection
bun run format
bun test showcase/examples/<app>
```

You should see `Wrote 8 files in showcase/examples/<app>`, then all tests pass. The first agent also mounts the `approval` feature and adds an Approvals screen. If you made a field required, add it to the `inspection.create` inputs in `test/triage-agent.test.ts`, or two tests fail with `INVALID_INPUT`.

The generated definition (`contracts/triage-agent.ts`):

```ts
export const triageAgent = defineAgent({
  id: 'inspection-desk.triage',
  title: 'Triage',
  instructions: 'List open inspections and read each one. When an inspection is finished, request approval for inspection.update ...',
  operations: ['inspection.list', 'inspection.get', 'inspection.update', 'approval.list'],
  model: 'any',
  output: 'request-approval', // commands become approval requests
  budgets: { turns: 8, toolCalls: 30, wallTimeMs: 180_000 },
});
```

A real one: `receiving.discrepancy` in `showcase/examples/receiving/contracts.ts`; `bun test showcase/examples/receiving/test/agent-scenarios.test.ts` covers it (1 pass).

## Harnesses

A harness runs the model and gives it the app's tools.

| Harness       | Runs                                         | Credentials                               |
| ------------- | -------------------------------------------- | ----------------------------------------- |
| Deterministic | A scripted list of commands. No model.       | none                                      |
| Codex         | The Codex app-server over stdio              | isolated home directory                   |
| Claude        | The Claude Agent SDK with the app's MCP tools | explicit API key only                    |
| AI SDK        | A tool loop over any AI SDK model            | explicit provider config                  |
| Local         | AI SDK loop on a loopback model              | none; only the `local-inference` destination |

Harnesses decline shell and file tools by default. A harness running as your OS user is not a sandbox. The [execution host](../plugins/execution-host/README.md) is a Linux sandbox for untrusted tools, but no harness uses it yet. Set up providers in [providers](providers.md).

## Runs

A run starts through the host's run route (`POST /api/v1/runs`) as the caller. Options:

- `agentId`: run as that definition, with its narrowed grant, instructions and budgets.
- `harnessId`: pick a harness; otherwise the first of the host's harnesses that meets the model requirement. `GET /api/v1/harnesses` lists them with whether each can run now.
- `conversationId`: continue an earlier conversation. Runs in one conversation run one after another.

States: queued, running, awaiting-question, awaiting-approval, succeeded, failed, cancelled, interrupted. Runs live in `.workspace/runs.sqlite` with what the person asked (`request`), their events and the answers to questions and approvals. The prompt a harness reads also holds the agent's instructions; the run keeps only the request. A harness that cannot resume its own session (AI SDK, local) gets the conversation's earlier requests and replies as chat messages, up to 16,000 characters, oldest left out first. After a restart, unfinished runs read `interrupted`; the host repeats nothing. The host caps output and redacts known secret formats, in the request too.

### Assistant panel

The frame's assistant panel talks to the application's agent definitions. Mount it as the aside in `defineScreens`:

```tsx
import { AssistantButton, AssistantPanel } from '@/components/assistant-panel';

export default defineScreens({ /* … */ aside: AssistantPanel, asideButton: AssistantButton });
```

The panel docks at the right of every screen and opens as a sheet on a compact viewport. It has a picker over the agent definitions, the conversation, a card for each question, approval and approval request, the review a run asks for, and Stop. Each message starts a run from the panel's UI session, which applies `ui.open`, `ui.select` and `ui.prepare` to the current screen. A screen hands the records it shows to the panel with `useAssistantContext` from `@/lib/assistant-context`, and the person can leave them out of the next run. The panel keeps the conversation ID per agent in local storage, so a reload shows the conversation again. It runs on the host's own harness, such as a local model, when the host offers one, else on the deterministic harness, until the person picks an account. `showcase/patterns/agents` and `showcase/examples/receiving` mount it.

### Runs from the command line

`runs` reaches a live instance through its connection file (`--connection` or `TORTOISE_CONNECTION`) and acts as that connection's session:

```sh
bun run --silent cli runs start --agent receiving.discrepancy --wait "Classify today's short counts."
bun run --silent cli runs answer <run> "ASN-1001-2"
bun run --silent cli runs list --conversation <conversation>
bun run --silent cli runs show <run>
```

`--wait` prints the run once it ends or asks, and exits 75 while it waits for an answer. `runs answer` takes the answer, or `--approve` or `--decline`, and waits again. `runs cancel <run>` stops a run.

## Application tools

Each capability becomes one tool (`inspection.update` → `inspection_update`). The run fixes its principal, workspace and grant at start; tool arguments can't change them. Each tool call gets an idempotency key from the provider's call ID.

A run started from a screen selection also gets `ui.open`, `ui.select`, `ui.prepare`, `ui.request-review` and, on AI SDK and local harnesses, `ask_person`. A run can't start another run.

## Agent definitions

`defineAgent` names what the agent may call. Two kinds:

- **Requesting** (`output: 'request-approval'`): runs its queries, turns its commands into approval requests.
- **Direct**: runs its commands itself. Each needs a UI binding. List exceptions in `requests` to send them for approval instead.

`agentGrant` narrows the starting person's grant to the definition's operations and, if it names resource types, to the records the run started on. Exceeding a budget fails the run with `BUDGET_EXCEEDED`.

## Approval requests

The `approval` feature lets an agent ask a person to run a command. Mount it with `approvalFeature` and an `ApprovalAccess` view.

| Capability                      | Caller        | Does                                                  |
| ------------------------------- | ------------- | ----------------------------------------------------- |
| `approval.request`              | agent         | Records the command, input, rationale, revisions read |
| `approval.approve`              | person        | Runs the command as the approver                      |
| `approval.reject`               | person        | Closes it with an optional reason                     |
| `approval.expire`               | job           | Closes it after expiry (24 h default)                 |
| `approval.list`, `approval.get` | anyone allowed | Reads                                                |

Approving runs the command under the approver's policy. If the record changed since the agent read it, approval fails with `CONFLICT` and the request stays pending. Agents can never approve or reject. The `approval-review` UI registry item shows pending requests with Approve and Reject.

## Assignments to agents

An [assignment](assignments.md) can name an agent definition as assignee. A trigger on the assignment event starts the run. The run reads the brief, records reports and marks the assignment done. Only a person can accept a report.

## Triggers and their grants

[`plugins/automation`](../plugins/automation/README.md) starts an agent or a job on a committed change or a schedule. Declare it in code:

```ts
// showcase/examples/winding-line/automation.ts
export const expireApprovals = defineTrigger({
  id: 'expire-approval-requests',
  title: 'Close expired approvals',
  on: { schedule: { everyMs: 5 * 60_000 } },
  run: { job: 'expire-approval-requests', operations: ['approval.list', 'approval.expire'] },
  budgets: { toolCalls: 200, wallTimeMs: 60_000 },
});
```

A trigger does nothing until a person issues a trigger grant (1 minute to 90 days). The run acts as that person, limited to the trigger's operations. If the person loses the role, the host refuses the run and shows a failure only they see. Trigger runs don't appear in the run panel. Give event triggers to requesting agents: a repeated agent run at most adds a second approval request.

## Local models

A model entry names base weights, an optional fine-tune and its dataset, each by digest. The [model server](../plugins/model-server/README.md) checks the digests before every start and serves through `llama-server` or vLLM. A fine-tune serves only after `gateModel` (in `packages/testing`) passes every agent scenario. Training data comes from `exportApprovalDataset`. Setup: [providers](providers.md#local-models) and [serve-a-local-model](../plugins/model-server/skills/serve-a-local-model/SKILL.md).

## Evaluation

An agent scenario gives an agent a task and starting state, then checks the receipts, approval requests and refusals, never the text. In CI it runs on the deterministic harness, which `scenarioHarness()` from `@tortoise/testing/agent-scenarios` returns. With `AGENT_SCENARIOS=live` it returns a model on an OpenAI-compatible server on this machine, such as `llama-server`, and the model then reads the task instead of the script:

```sh
AGENT_SCENARIOS=live AGENT_SCENARIOS_URL=http://127.0.0.1:8080/ AGENT_SCENARIOS_MODEL=<id> \
  bun test showcase/examples/receiving/test/agent-scenarios.test.ts
LOCAL_MODEL_GGUF=~/models/gemma-4-E4B-it-Q4_0.gguf bun test plugins/model-server/test/live.test.ts
```

The address must be loopback, and the harness sends no key. A test allows a live scenario 15 minutes (`scenarioTimeout()`).

Other tests: `bun run test:harness`, `bun test plugins/automation`, `bun test plugins/model-server`.

## Limits

- A run keeps its last 256 events, so a very long run loses its beginning, and the earlier turns a harness gets lose that text too.
- The panel shows one conversation per agent and browser. Earlier conversations stay on the host, and `runs list` shows them.

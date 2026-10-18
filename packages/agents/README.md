# @agent-native/agents

This package runs agents as ordinary [callers](../../docs/glossary.md#caller) on the [catalog](../../docs/glossary.md#catalog). The run supervisor gives a [harness](../../docs/glossary.md#harness) only [capabilities](../../docs/glossary.md#capability) as tools and runs them under the narrowed [grant](../../docs/glossary.md#grant) of the caller who started the run. It keeps narration apart from what was committed.

## Layer

Framework (`packages/*`). Server only. The host constructs harnesses with explicitly chosen credentials, and applications do not import this package. Codex, Claude and AI SDK harnesses are [adapters](../../docs/glossary.md#adapter) behind one `Harness` port, next to a deterministic harness that needs no provider. The package also holds the provider account flows, for a ChatGPT plan and generic OIDC, and the credential vault.

## Primitives

- [Agent run](../../docs/primitives.md#agent-run):
  - the port and harnesses: `Harness`, `HarnessEvent`, `deterministicHarness`, `CodexHarness`, `ClaudeHarness`, `AiSdkHarness`, `HarnessInference`, `ModelIdentity`;
  - the local harness: `localHarness`, `LocalModel`, `LocalModelClient`, `LocalHarnessOptions`;
  - the supervisor: `createRunSupervisor`, `RunState`, `RunStore`, `MemoryRunStore`;
  - audit: the supervisor's `onRun` observer and `runAuditRecord`, which turn a run's start and end into `run.started` and `run.ended` audit records;
  - placement: `satisfiesModel` and `chooseHarness`;
  - `RunBudget`: the per-run limits of an [agent definition](../../docs/primitives.md#agent-definition), which the supervisor enforces.
- [Model entry](../../docs/primitives.md#model-entry): `ModelEntry`, `defineModelEntry`, `entryIdentity`, `ModelActivation` and `activates`. `ModelDemand` carries an agent's named models into `satisfiesModel` and `chooseHarness`.
- [UI session context](../../docs/primitives.md#ui-session-context): `modelPrompt` shows the model only the captured selection and the revisions the person saw.
- [OS action](../../docs/primitives.md#os-action): `openAiComponent` declares `openai.authorize`, the ChatGPT sign-in page the desktop opens in the system browser.
- [Credential vault](../../docs/primitives.md#credential-vault): `CredentialVault`, `OsCredentialVault`, `MemoryCredentialVault`, `OidcAccountConnection` and `ChatGptAccountConnection`.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/agents` | server only | Everything below except `process` and `requirements`. |
| `@agent-native/agents/*` | server only | One source file; a subpath avoids loading every provider SDK. |
| `@agent-native/agents/types` | server only | `Harness`, `ToolPort`, `RunState`, `RunEvent`, `RunStore`, `modelPrompt`, `toolName`. |
| `@agent-native/agents/supervisor` | server only | `createRunSupervisor`, `MemoryRunStore`, `runAuditRecord`. |
| `@agent-native/agents/deterministic` | server only | `deterministicHarness`: a declarative command script that needs no credential. |
| `@agent-native/agents/codex` | server only | `CodexHarness` and `chatGptCodexOptions`, over the Codex app-server and JSON-RPC. |
| `@agent-native/agents/claude` | server only | `ClaudeHarness`: the Claude Agent SDK with an in-process MCP server. |
| `@agent-native/agents/ai-sdk` | server only | `AiSdkHarness` over a host-constructed AI SDK model. |
| `@agent-native/agents/chatgpt` | server only | `ChatGptAccountConnection`: dynamic registration, PKCE, profile, refresh and logout. |
| `@agent-native/agents/oidc` | server only | `OidcAccountConnection`, `verifyOidcIdentity`. |
| `@agent-native/agents/credentials` | server only | The vault port, with OS keyring and in-memory implementations. |
| `@agent-native/agents/process` | server only | Process-tree termination, explicit native environments and stdio JSON-RPC. |
| `@agent-native/agents/local` | server only | `localHarness` over an OpenAI-compatible server on this host; it loads the SDK per run. |
| `@agent-native/agents/placement` | server only | `satisfiesModel`, `chooseHarness`, `ModelDemand`: which harness may run an agent's model. |
| `@agent-native/agents/models` | server only | `ModelEntry`, `defineModelEntry`, `entryIdentity`, `ModelActivation`, `activates`. |
| `@agent-native/agents/requirements` | server only | `providerComponents`, `localInferenceComponent` and `LOCAL_INFERENCE_DESTINATION`, as data. |

A caller may pass the run ID to `start`. A run repeated after a restart then keeps its tool calls' idempotency keys. Starting an ID that already exists throws.

## Trust boundary

### Tools

Tools are capabilities only. Tool implementations derive identity and grant from the run, never from model arguments. They recheck cancellation at their commit boundary. A duplicate invocation ID executes once.

In the AI SDK harness, some failures go back to the model as that call's result: an application refusal (an `ApplicationError`) and a call the model could not form. The model may then correct the call within its turn and tool-call budgets, as an MCP client reads `isError`. Any other tool failure, a spent budget or a cancellation ends the run.

### Run output

Text and progress stream separately from commits. Partial output never turns a failed run into a success. Secrets are redacted before persistence, including a secret split across streamed deltas. Cancellation stops future work without undoing commits. A restart marks unfinished runs interrupted instead of replaying them.

### ChatGPT sign-in

The `openai.authorize` parameter schema is the only rule for opening ChatGPT sign-in outside the application. It requires:

- the authorization endpoint;
- a loopback callback;
- the authorization-code flow with S256;
- a 43-character random state, nonce and challenge.

`test/requirements.test.ts` keeps the schema in step with `authorizationRequest`.

### Provider credentials

Provider credentials are never discovered from the environment or from developer configuration. They never reach browser state, model context or run logs. An exhausted plan does not fall back silently to an API key.

The OS vault fails closed when the keyring is locked or unavailable. `MemoryCredentialVault` is a fixture the host selects explicitly, and the OS vault does not fall back to it. Account connections serialize credential writes, so a sign-in or refresh already in flight cannot undo a logout.

### Local harness

The local harness never builds its own address. It hands relative paths to a client the host takes from the network port's `local-inference` destination, and the egress guard enforces that destination's loopback scope. It sends the placeholder key `local`, so it never reads `OPENAI_API_KEY` or `OPENAI_BASE_URL`. A run started with a model requirement refuses a harness that does not meet it. A harness that does not declare `inference` counts as remote, so it never runs a `local` agent.

### Model entries

A [model entry](../../docs/glossary.md#model-entry) names a base model, an optional LoRA or merged fine-tune, and the dataset it was tuned on, each by `sha256:` digest. It also states its license, its context size and the agents it admits. `localHarness({ entry })` lists the model under the entry ID and records the entry's digests on each run. The digests count as `verified` only when the host measured the files, as the [model server plugin](../../plugins/model-server/README.md) does.

An agent that names `models` runs only on a harness serving one of them. An entry that names `agents` serves only those, so a fine-tune made for one task is never picked for another. `ModelActivation` is what the model gate in `@agent-native/testing/activation` records, and `activates` checks one against an entry's exact digests.

### Child processes

Child processes get an explicit environment and the egress proxy variables. `process.ts`, `claude.ts`, `chatgpt.ts` and `oidc.ts` are reviewed egress exemptions in `scripts/boundary-rules.ts`.

## Dependencies

Framework: `@agent-native/contracts`. External: `@anthropic-ai/claude-agent-sdk`, `ai`, `@ai-sdk/openai`, `jose`, `@napi-rs/keyring`, `zod`.

## Tests

```sh
bun run test:harness
```

The tests use deterministic fixtures only. Paths are relative to this package.

- `test/supervisor.test.ts`: run state separate from commits, redaction, one-use questions and interrupted-run recovery. An observer hears each run start and end once, without its prompt or output.
- `test/budget.test.ts`: a run fails with `BUDGET_EXCEEDED` instead of making one tool call past its budget or running past its wall time, and it releases a waiting question. The harness receives the turn limit.
- `test/adapters.test.ts`: each harness against shared fixtures, where every model sees the captured selection and never the run's identity or grant. The AI SDK harness returns a refusal and a malformed call to the model, and ends the run on any other tool failure.
- `test/chatgpt.test.ts`: PKCE, OIDC validation, locked-vault abort, serialized refresh and logout.
- `test/process.test.ts`: explicit environments, JSON-RPC failure propagation and subprocess-tree cancellation.
- `test/local.test.ts`: the local harness against a loopback OpenAI-compatible fixture server, with harness choice by model requirement and the model identity on the run record. It also covers named models and an entry's agents narrowing the choice, an entry's identity and a readiness check.
- `test/requirements.test.ts`: the authorization URL is one the declared open action builds, and a different flow, endpoint or callback does not match.

`scripts/live-smoke.ts` is an opt-in live probe with a fixed synthetic prompt. It needs an explicitly configured account and never reads developer credential files.

## Skills

- [serve-a-local-model](../../plugins/model-server/skills/serve-a-local-model/SKILL.md): model entries, named models on agents and the activation gate.

None for harness adapters or provider connections.

## References

- [Agents](../../docs/agents.md)
- [Providers](../../docs/providers.md)
- [Authorization](../../docs/authorization.md)

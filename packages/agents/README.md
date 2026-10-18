# @agent-native/agents

Agent runs as ordinary callers on the catalog. The run supervisor gives a harness only catalog operations as tools, runs them under the narrowed grant of whoever started the run, and keeps narration apart from what was committed. Codex, Claude and AI SDK harnesses are adapters behind one `Harness` port, next to a deterministic harness that needs no provider. The package also holds the provider account flows (ChatGPT plan, generic OIDC) and the credential vault.

Layer: framework (`packages/*`). Server only. The host constructs harnesses with explicitly chosen credentials; applications do not import this package.

## Primitives

- [Agent run](../../docs/primitives.md#agent-run): `Harness`, `HarnessEvent`, `createRunSupervisor` (with its `onRun` observer and `runAuditRecord`, which turn a run's start and end into `run.started` and `run.ended` audit records), `RunState`, `RunStore`, `MemoryRunStore`, `deterministicHarness`, `CodexHarness`, `ClaudeHarness`, `AiSdkHarness`, `localHarness` (`LocalModel`, `LocalModelClient`, `LocalHarnessOptions`), `HarnessInference` and `ModelIdentity`, the placement checks `satisfiesModel` and `chooseHarness`, and `RunBudget`, the per-run limits of an [agent definition](../../docs/primitives.md#agent-definition) that the supervisor enforces.
- [Model entry](../../docs/primitives.md#model-entry): `ModelEntry`, `defineModelEntry`, `entryIdentity`, `ModelActivation` and `activates`; `ModelDemand` carries an agent's named models into `satisfiesModel` and `chooseHarness`.
- [UI session context](../../docs/primitives.md#ui-session-context): `modelPrompt` shows the model the captured selection and the revisions the person saw, nothing else.
- [OS action](../../docs/primitives.md#os-action): `openAiComponent` declares `openai.authorize`, the ChatGPT sign-in page the desktop opens in the system browser.
- [Credential vault](../../docs/primitives.md#credential-vault): `CredentialVault`, `OsCredentialVault`, `MemoryCredentialVault`; `OidcAccountConnection` and `ChatGptAccountConnection`.

Read the [harness guide](../../docs/agents.md), [providers](../../docs/providers.md) and [authorization](../../docs/authorization.md). Provider credentials fund inference and never grant workspace access.

## Entrypoints

| Import                               | Runs in     | Contents                                                                                      |
| ------------------------------------ | ----------- | --------------------------------------------------------------------------------------------- |
| `@agent-native/agents`               | server only | Everything below except `process` and `requirements`.                                         |
| `@agent-native/agents/*`             | server only | One source file, listed below. Import a subpath to avoid loading every provider SDK.          |
| `@agent-native/agents/types`         | server only | `Harness`, `ToolPort`, `RunState`, `RunEvent`, `RunStore`, `modelPrompt`, `toolName`.         |
| `@agent-native/agents/supervisor`    | server only | `createRunSupervisor`, `MemoryRunStore`, `runAuditRecord`.                                    |
| `@agent-native/agents/deterministic` | server only | `deterministicHarness`: a declarative command script, credential-free.                        |
| `@agent-native/agents/codex`         | server only | `CodexHarness`, `chatGptCodexOptions` (Codex app-server over JSON-RPC).                       |
| `@agent-native/agents/claude`        | server only | `ClaudeHarness` (Claude Agent SDK with an in-process MCP server).                             |
| `@agent-native/agents/ai-sdk`        | server only | `AiSdkHarness` over a host-constructed AI SDK model.                                          |
| `@agent-native/agents/chatgpt`       | server only | `ChatGptAccountConnection`: dynamic registration, PKCE, profile, refresh and logout.          |
| `@agent-native/agents/oidc`          | server only | `OidcAccountConnection`, `verifyOidcIdentity`.                                                |
| `@agent-native/agents/credentials`   | server only | Vault port and the OS keyring and in-memory implementations.                                  |
| `@agent-native/agents/process`       | server only | Process-tree termination, explicit native environments, stdio JSON-RPC.                       |
| `@agent-native/agents/local`         | server only | `localHarness` over an OpenAI-compatible server on this host. Loads the SDK per run.          |
| `@agent-native/agents/placement`     | server only | `satisfiesModel`, `chooseHarness`, `ModelDemand`: which harness may run an agent's model.     |
| `@agent-native/agents/models`        | server only | `ModelEntry`, `defineModelEntry`, `entryIdentity`, `ModelActivation`, `activates`.            |
| `@agent-native/agents/requirements`  | server only | `providerComponents` (with `localInferenceComponent`, `LOCAL_INFERENCE_DESTINATION`) as data. |

Four entries are composers over a folder of parts that are imported only from inside the package:

- `src/supervisor/`: the in-memory run store, bounded event queue, redaction, the run record and its persisted events, turn execution, replay and the run lifecycle (start, cancel, pending requests, interrupted-run recovery). A caller may pass the run ID to `start`, so a run repeated after a restart keeps its tool calls' idempotency keys; starting an ID that already exists throws.
- `src/codex/`: the app-server process and thread setup, and the translation of its messages (tool calls, questions, completion).
- `src/claude/`: the in-process MCP server that exposes the application's tools. The SDK process launch stays in `claude.ts`, the egress-exempt file.
- `src/chatgpt/`: the vault-backed profile store, the PKCE authorization request and callback checks, and the token and revocation endpoints. The default `fetch` is chosen only in `chatgpt.ts`.

## Trust boundary

Tools are catalog operations only; tool implementations derive identity and grant from the run, never from model arguments, and recheck cancellation at their commit boundary. A duplicate invocation ID executes once. In the AI SDK harness, an application refusal (an `ApplicationError`) and a call the model could not form go back to the model as that call's result, so it may correct the call within its turn and tool-call budgets, as an MCP client reads `isError`. Any other tool failure, a spent budget or a cancellation ends the run. The `openai.authorize` parameter schema is the only rule for opening ChatGPT sign-in outside the app: the authorization endpoint, a loopback callback, the authorization-code flow with S256, and 43-character random state, nonce and challenge; `test/requirements.test.ts` keeps it in step with `authorizationRequest`. Text and progress stream separately from commits, partial output never turns a failed run into a success, and secrets are redacted before persistence, including a secret split across streamed deltas. Cancellation stops future work without undoing commits; a restart marks unfinished runs interrupted instead of replaying them.

Provider credentials pay for inference and never grant workspace access. They are never discovered from the environment or developer configuration, never reach browser state, model context or run logs, and an exhausted plan never falls back silently to an API key. The OS vault fails closed when the keyring is locked or unavailable; `MemoryCredentialVault` is an explicitly selected fixture, not a fallback. Account connections serialize credential writes, so a logout cannot be undone by a sign-in or refresh already in flight.

The local harness never builds its own address: it hands relative paths to a client the host takes from the network port's `local-inference` destination, whose loopback scope the guard enforces. It sends the placeholder key `local` and so never reads `OPENAI_API_KEY` or `OPENAI_BASE_URL`. A run started with a model requirement refuses a harness that does not meet it; a harness that does not declare `inference` counts as remote, so it never runs a `local` agent.

A model entry names a base model, an optional LoRA or merged fine-tune and the dataset it was tuned on, each by `sha256:` digest, with its license, context size and the agents it admits. `localHarness({ entry })` lists the model under the entry ID and records the entry's digests on each run; they count as `verified` only when the host measured the files (the [model server plugin](../../plugins/model-server/README.md) does). An agent that names `models` runs only on a harness serving one of them, and an entry that names `agents` serves only those, so a fine-tune made for one task is never picked for another. `ModelActivation` is what the model gate in `@agent-native/testing/activation` records; `activates` checks one against an entry's exact digests.

Child processes get an explicit environment and the egress proxy variables. `process.ts`, `claude.ts`, `chatgpt.ts` and `oidc.ts` are reviewed egress exemptions in `scripts/boundary-rules.ts`.

## Dependencies

Framework: `@agent-native/contracts`. External: `@anthropic-ai/claude-agent-sdk`, `ai`, `@ai-sdk/openai`, `jose`, `@napi-rs/keyring`, `zod`.

## Tests

```sh
bun run test:harness
```

Deterministic fixtures only; they prove adapter and protocol behavior, not provider login or inference access.

- `test/supervisor.test.ts`: run state separate from commits, redaction, one-use questions, interrupted-run recovery, and an observer that hears each run start and end once without its prompt or output.
- `test/budget.test.ts`: a run fails with `BUDGET_EXCEEDED` instead of making one tool call more than its budget or running past its wall time (releasing a waiting question), and the harness receives the turn limit.
- `test/adapters.test.ts`: each harness against shared fixtures; every model sees the captured selection and never the run's identity or grant; the AI SDK harness hands a refusal and a malformed call back to the model and ends the run on any other tool failure.
- `test/chatgpt.test.ts`: PKCE, OIDC validation, locked-vault abort, serialized refresh and logout.
- `test/process.test.ts`: explicit environments, JSON-RPC failure propagation, subprocess-tree cancellation.
- `test/local.test.ts`: the local harness against a loopback OpenAI-compatible fixture server (tool call, finish, placeholder key, unserved model, unbound destination), harness choice by model requirement, and the model identity on the run record; named models and an entry's agents narrowing the choice, an entry's identity and a readiness check.

`scripts/live-smoke.ts` is an opt-in live probe with a fixed synthetic prompt. It needs an explicitly configured account and never reads developer credential files.

## Skills

- [serve-a-local-model](../../plugins/model-server/skills/serve-a-local-model/SKILL.md): model entries, named models on agents and the activation gate.

Adding a harness adapter or provider connection has no skill; it follows [agent harnesses](../../docs/agents.md) and [providers](../../docs/providers.md).

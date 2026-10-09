# @agent-native/agents

Agent runs as ordinary callers on the catalog. The run supervisor gives a harness only catalog operations as tools, runs them under the narrowed grant of whoever started the run, and keeps narration apart from what was committed. Codex, Claude and AI SDK harnesses are adapters behind one `Harness` port, next to a deterministic harness that needs no provider. The package also holds the provider account flows (ChatGPT plan, generic OIDC) and the credential vault.

Layer: framework (`packages/*`). Server only. The host constructs harnesses with explicitly chosen credentials; applications do not import this package.

## Primitives

- [Agent run](../../docs/primitives.md#agent-run): `Harness`, `HarnessEvent`, `createRunSupervisor`, `RunState`, `RunStore`, `MemoryRunStore`, `deterministicHarness`, `CodexHarness`, `ClaudeHarness`, `AiSdkHarness`.
- [UI session context](../../docs/primitives.md#ui-session-context): `modelPrompt` shows the model the captured selection and the revisions the person saw, nothing else.
- [Credential vault](../../docs/primitives.md#credential-vault): `CredentialVault`, `OsCredentialVault`, `MemoryCredentialVault`; `OidcAccountConnection` and `ChatGptAccountConnection`.

Read the [harness guide](../../docs/agent-harnesses.md), [providers](../../docs/providers.md) and [ADR 003](../../docs/decisions/003-authority-and-credentials.md).

## Entrypoints

| Import                               | Runs in     | Contents                                                                              |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------- |
| `@agent-native/agents`               | server only | Everything below except `process` and `requirements`.                                 |
| `@agent-native/agents/*`             | server only | One source file, listed below. Import a subpath to avoid loading every provider SDK.  |
| `@agent-native/agents/types`         | server only | `Harness`, `ToolPort`, `RunState`, `RunEvent`, `RunStore`, `modelPrompt`, `toolName`. |
| `@agent-native/agents/supervisor`    | server only | `createRunSupervisor`, `MemoryRunStore`.                                              |
| `@agent-native/agents/deterministic` | server only | `deterministicHarness`: a declarative command script, credential-free.                |
| `@agent-native/agents/codex`         | server only | `CodexHarness`, `chatGptCodexOptions` (Codex app-server over JSON-RPC).               |
| `@agent-native/agents/claude`        | server only | `ClaudeHarness` (Claude Agent SDK with an in-process MCP server).                     |
| `@agent-native/agents/ai-sdk`        | server only | `AiSdkHarness` over a host-constructed AI SDK model.                                  |
| `@agent-native/agents/chatgpt`       | server only | `ChatGptAccountConnection`: dynamic registration, PKCE, profile, refresh and logout.  |
| `@agent-native/agents/oidc`          | server only | `OidcAccountConnection`, `verifyOidcIdentity`.                                        |
| `@agent-native/agents/credentials`   | server only | Vault port and the OS keyring and in-memory implementations.                          |
| `@agent-native/agents/process`       | server only | Process-tree termination, explicit native environments, stdio JSON-RPC.               |
| `@agent-native/agents/requirements`  | server only | `providerComponents`: the provider destinations and processes as data. Loads no SDK.  |

Four entries are composers over a folder of parts that are imported only from inside the package:

- `src/supervisor/`: the in-memory run store, bounded event queue, redaction, the run record and its persisted events, turn execution, replay and the run lifecycle (start, cancel, pending requests, interrupted-run recovery).
- `src/codex/`: the app-server process and thread setup, and the translation of its messages (tool calls, questions, completion).
- `src/claude/`: the in-process MCP server that exposes the application's tools. The SDK process launch stays in `claude.ts`, the egress-exempt file.
- `src/chatgpt/`: the vault-backed profile store, the PKCE authorization request and callback checks, and the token and revocation endpoints. The default `fetch` is chosen only in `chatgpt.ts`.

## Trust boundary

Tools are catalog operations only; tool implementations derive identity and grant from the run, never from model arguments, and recheck cancellation at their commit boundary. A duplicate invocation ID executes once. Text and progress stream separately from commits, partial output never turns a failed run into a success, and secrets are redacted before persistence, including a secret split across streamed deltas. Cancellation stops future work without undoing commits; a restart marks unfinished runs interrupted instead of replaying them.

Provider credentials pay for inference and never grant workspace access. They are never discovered from the environment or developer configuration, never reach browser state, model context or run logs, and an exhausted plan never falls back silently to an API key. The OS vault fails closed when the keyring is locked or unavailable; `MemoryCredentialVault` is an explicitly selected fixture, not a fallback. Account connections serialize credential writes, so a logout cannot be undone by a sign-in or refresh already in flight.

Child processes get an explicit environment and the egress proxy variables. `process.ts`, `claude.ts`, `chatgpt.ts` and `oidc.ts` are reviewed egress exemptions in `scripts/boundary-rules.ts`.

## Dependencies

Framework: `@agent-native/contracts`. External: `@anthropic-ai/claude-agent-sdk`, `ai`, `@ai-sdk/openai`, `jose`, `@napi-rs/keyring`, `zod`.

## Tests

```sh
bun run test:harness
```

Deterministic fixtures only; they prove adapter and protocol behavior, not provider login or inference access.

- `test/supervisor.test.ts`: run state separate from commits, redaction, one-use questions, interrupted-run recovery ([P6](../../docs/principles.md#p6--status-says-what-is-known)).
- `test/adapters.test.ts`: each harness against shared fixtures; every model sees the captured selection and never the run's identity or grant ([P3](../../docs/principles.md#p3--authority-comes-from-trusted-context), [P9](../../docs/principles.md#p9--external-dependencies-sit-behind-ports)).
- `test/chatgpt.test.ts`: PKCE, OIDC validation, locked-vault abort, serialized refresh and logout.
- `test/process.test.ts`: explicit environments, JSON-RPC failure propagation, subprocess-tree cancellation.

`scripts/live-smoke.ts` is an opt-in live probe with a fixed synthetic prompt. It needs an explicitly configured account and never reads developer credential files.

# @tortoise/agents

`@tortoise/agents` adapts provider execution to the host's agent-run interface. `createRunSupervisor` coordinates the selected harness and the application tools granted to that run. A tool obtains trusted identity from its run context; model-generated arguments cannot establish that identity.

## Harness implementations

| Harness | Implementation | Execution configuration |
| --- | --- | --- |
| `deterministic` | `DeterministicHarness` | Executes fixture scripts without provider inference |
| `codex` | `CodexHarness` | Uses the connected ChatGPT profile and a verified Codex runtime |
| `claude` | `ClaudeHarness` | Uses a configured Anthropic API key and the verified Claude runtime |
| `ai-sdk` | `AiSdkHarness` | Receives an explicitly constructed provider model |
| `local` | `localHarness` | Calls a configured OpenAI-compatible model on loopback |

Codex execution disables shell and file-edit tools in its read-only runtime. Claude receives the application's MCP tools with built-in tools and settings sources disabled. The AI SDK adapter refuses a string model alias, preventing implicit gateway configuration from selecting a credential.

Codex retains its thread identifier for continuation. Claude retains its provider session identifier. The other harnesses rely on the host's supplied conversation history. Questions are available through the applicable harness's declared support and the run's UI context; callers must inspect harness availability before starting a run.

## Provider boundary

The host passes a measured runtime executable to a process harness. It does not resolve a provider CLI from ambient `PATH`. A run has its own working directory and a restricted environment. Conversation homes are owner-only. Closing the process tree manages its lifetime; containment for tool execution requires the separately configured execution host.

`OsCredentialVault` uses the platform credential store under a workspace namespace. A locked or unavailable store returns an error. Runtime credentials are supplied after the host has loaded the selected profile or key, and are checked again before provider execution. Provider processes do not obtain an unrestricted workspace transport.

The supervisor handles cancellation and outstanding tool callbacks. A provider response is successful only after its result validates and its tool calls have completed. A failed run can have committed application commands, so recovery must inspect retained command results before retrying work.

The [agent guide](../../docs/agents.md) owns run configuration and account connection. The [local-model task guide](../../plugins/model-server/skills/serve-a-local-model/SKILL.md) covers measured weight files and model-server composition.

## Verification

From the repository root, `bun run test:harness` exercises provider adapter fixtures. Account connection fixtures are in `packages/host/test/providers.test.ts`. These use local stand-ins and do not establish a provider account's current behavior. The opt-in script `packages/agents/scripts/live-smoke.ts` requires explicitly configured credentials and `AGENT_LIVE_ALLOWED=1`.

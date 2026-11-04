# Providers and account connections

An agent harness runs on a model provider account that the local user connects. The provider pays for inference; it never gets workspace access. Agents reach data only through the application's tools ([agents](agents.md#application-tools)).

## Try it

```sh
bun test packages/host/test/providers.test.ts
bun run test:harness
```

Both run offline: sign-in runs against a local signed OIDC server, and the Claude MCP bridge and AI SDK stream run without a provider.

## Harnesses

| Harness | Paid by | Resume | Questions and approvals |
| --- | --- | --- | --- |
| `deterministic` | Nothing (test fixture) | No | Both, with timeouts |
| `codex` | ChatGPT plan | Thread ID | Questions; shell and file approvals always declined |
| `claude` | Anthropic API key | Session ID | Neither |
| `ai-sdk` | OpenAI API key | No | Questions, in runs started from a screen |
| `local` | Nothing (your own server) | No | Questions, in runs started from a screen |

Every harness sees only application tools. Codex runs with shell, edit and search off in a read-only sandbox. Claude gets only the app's MCP tools, no built-ins and no settings sources. The AI SDK adapter refuses string model aliases, so it can't pick up a gateway key from the environment.

A run succeeds only when the provider's final result validates and every tool call has finished. Run records keep the resume ID but no credentials or prompts.

## Connect an account

Only the local user, without a delegated grant, can manage provider access. Bind each provider's destination (declared in `packages/agents/src/requirements.ts`) in the deployment policy; without a binding a run says why it can't start.

- **ChatGPT (Codex):** open the account screen and sign in. The system browser opens; the host listens on a loopback callback, uses PKCE, one-time state and a nonce, and verifies the ID token on the server. Inference needs the `resource.invoke` and `chatgpt.tokens.use.direct` scopes; without them the host keeps the profile but disables it. Tokens refresh within a minute of expiry. Logout deletes tokens locally, then asks the provider to revoke them and reports whether it did.
- **Anthropic or OpenAI key (Claude, AI SDK):** paste the key on the account screen. The host saves it in the credential vault; a run can use it only after the running host has saved or loaded it. API-key runs never fall back to ChatGPT credentials.

A run fixes its profile, model or key when it starts, and checks the credential is still loaded before the provider runs.

## Credential vault

Credentials live in the OS vault: Keychain on macOS, Credential Manager on Windows, Secret Service on Linux (needs a desktop D-Bus session). If the store is locked, denied or missing, you get an error; there is no fallback to files, database or environment. Each workspace has its own namespace. Startup never probes the keyring, so unlock prompts appear only when you act on an account.

## Provider processes

Codex and Claude executables come from the bundled runtime manifest, checked by digest before each run, never from `PATH`. Each run gets its own working directory and each conversation its own home, readable only by the owner, with an allowlisted environment plus the injected credential. The host closes the process tree on completion or cancel. This is lifetime management, not a sandbox.

## Local models

The `local` harness talks to an OpenAI-compatible server on the same machine, such as Ollama, llama.cpp `llama-server` or vLLM.

1. Start the server and note the model ID it lists at `/v1/models`.
2. Bind the `local-inference` destination in the deployment policy, e.g. `http://127.0.0.1:11434` for Ollama. The network guard refuses any address off this host.
3. Configure the model ID, and optionally the weights digest. The harness is available only while the server lists that model.

Each run record keeps the model ID and digest. For a server you run yourself, the run record marks the digest unverified. The [model server plugin](../plugins/model-server/README.md) starts `llama-server` or vLLM for you, hashes the weights before each start, and records the digest as verified.

An agent's model requirement picks which harnesses may run it: `local` (prompts stay on this host), `remote` (provider harnesses) or `any`. A harness that doesn't declare where prompts go counts as remote.

## Run supervision

The supervisor bounds every run the same way ([agents](agents.md#runs)): duplicate tool callbacks share one result, a reused call ID with new arguments fails, at most one question or approval waits (5-minute default timeout), a slow subscriber gets an explicit reset, and a failed run-store write aborts the run.

## Live check

Opt-in, with explicit permission and credentials from a secure environment:

```sh
AGENT_LIVE_ALLOWED=1 bun packages/agents/scripts/live-smoke.ts claude
```

It sends one synthetic prompt and one read-only tool call through `codex`, `claude` or `ai-sdk`. A new adapter documents its runtime version, credential source, tool boundary, success rule, cancellation and resume, and adds fixtures for success, partial failure and tool rejection.

## Limits

- The web accounts panel doesn't offer the `local` harness; a run started without a harness uses the model server's.
- Only tests use the generic OIDC connection.
- The model server doesn't manage Ollama, so Ollama runs are unverified.
- Process-tree cleanup on Windows and Linux needs those platforms' smoke tests.

## See also

[Agents](agents.md) · [Desktop](desktop.md) · [Implementation status](implementation-status.md#agents-and-providers) · [Codex app-server](https://developers.openai.com/codex/app-server/) · [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) · [AI SDK](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)

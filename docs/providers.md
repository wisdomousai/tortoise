# Providers and account connections

The host runs agent harnesses under provider accounts that the local owner connects.

## Concepts

Terms: the [credential vault](glossary.md#credential-vault).

## Provider harnesses

A [harness](glossary.md#harness) reaches business data only through the application's tools, which pass through the [instance](glossary.md#instance) like any other caller ([agents](agents.md#application-tools)). Provider credentials pay for inference and give no access to a workspace.

| Harness         | Funding chosen by the host | Native resume | Questions and approvals                                    |
| --------------- | -------------------------- | ------------- | ---------------------------------------------------------- |
| `deterministic` | None                       | No            | Both, with timeouts                                        |
| `codex`         | A ChatGPT plan profile     | Thread ID     | Native questions; shell and file approvals always declined |
| `claude`        | An Anthropic API key       | Session ID    | Neither                                                    |
| `ai-sdk`        | An OpenAI API key          | No            | Questions in a run started from a screen                   |
| `local`         | None                       | No            | Questions in a run started from a screen                   |

Each adapter is limited to application tools. Codex runs the app-server with shell, edit and search disabled and a read-only sandbox. Its protocol version is pinned because its dynamic tools are still experimental. Claude sees only the application's MCP tools, with no built-in tools and no settings sources. The AI SDK adapter refuses a string model alias, so it cannot pick up an ambient gateway credential.

A run succeeds only when the adapter has validated the provider's terminal result and every tracked tool call has finished. Native thread and session IDs are kept for resuming, and run records hold neither credentials nor prompts.

## Provider processes

The Codex and Claude executables come from the bundled runtime manifest. Before a run, the host checks every packaged file's digest and the executable bit, and it never uses an executable found on `PATH`. Each run gets its own working directory and each conversation its own home directory, readable only by the owner. A provider process gets an allowlisted environment plus the credentials injected for it, and no API keys, developer CLI configuration or developer `PATH`.

The desktop build compiles the Claude SDK into the host, so no separate Node runtime is needed ([desktop](desktop.md#packaged-resources)). Native adapters close their child processes as a whole process tree on completion and cancellation. This manages lifetime and is no sandbox against a hostile executable. Process-tree behavior on Windows and Linux needs those platforms' smoke tests.

## Provider configuration

The provider adapters declare their [destinations](glossary.md#destination) as [host components](glossary.md#host-component) in `packages/agents/src/requirements.ts`, and the [deployment policy](glossary.md#deployment-policy) binds them. Every destination is optional and unavailable offline. Without a binding, a model run reports why it cannot start.

Only the local [owner](glossary.md#owner), acting without a [delegated grant](glossary.md#grant), manages provider access. The host rechecks that the owner's [session](glossary.md#session) is still live after each awaited step.

## ChatGPT connection

The connection follows the documented dynamic public-client flow. The instance starts its loopback callback before it begins sign-in. The account screen opens sign-in in the system browser through a declared [OS action](glossary.md#os-action).

- **Enrollment.** A new enrollment registers with the application name and an opaque host ID kept in the OS vault. A returning profile uses its issued client ID.
- **Each attempt** lives five minutes and uses one-time state, a nonce and PKCE.
- **The session** that began an attempt must stay live through the code exchange. A profile connected after it was revoked is logged out again.
- **The callback** checks the state, the exact loopback target and the client ID. A returning sign-in must match the stored subject.
- **Token verification** runs on the server after the code exchange and checks the ID token's signature, issuer, audience, expiry and nonce.
- **Authorization URLs** are never logged and include no ID-token hint, so no stored token reaches browser code.
- **Inference** needs both the `resource.invoke` and `chatgpt.tokens.use.direct` scopes. A verified identity without them is kept as a disabled profile.

Profile listing and status return metadata without tokens. Only the instance reads a profile's tokens, and it refuses for a profile that is disconnected, lacks the inference scopes or has expired. The host refreshes tokens within a minute of expiry, and the whole rotating refresh write runs serialized.

Logout removes the access, refresh and ID tokens locally and keeps the registration. It then attempts revocation at the provider and reports whether revocation was confirmed. No local token remains as a fallback.

A generic OIDC connection exists for explicitly enrolled providers, with a client ID from the host's configuration instead of ChatGPT's bootstrap client. It verifies every ID token before trusting it.

## API keys

The Claude and AI SDK adapters run on an API key the owner enters, which the host saves in the credential vault. A run may use the key only after the owner saved or loaded it in the running host. Disconnecting removes it from the vault. An API-key run does not fall back to ChatGPT plan credentials.

A run captures the selected profile and model, or the API-key account, when it starts, and a later selection does not change them. Before the provider runs, the host checks again that the profile or key is still loaded.

## Credential vault

The OS credential vault runs in the instance and does not depend on Electron. It uses Keychain on macOS, the credential store on Windows, and Secret Service on Linux, which needs a desktop D-Bus session. A locked, denied or missing store is an error. The vault does not fall back to files, the database, environment variables or a test vault.

The host uses one vault namespace per workspace, under the workspace's lock. A deployment that shares profiles across processes needs a single refresh owner for each namespace. A keyring may show its own unlock prompt during an explicit account action, but startup and status checks never probe it. The packaged build embeds the native addon instead of loading it dynamically. The in-memory vault exists for tests only.

## Local models

The `local` harness runs AI SDK chat completions against an OpenAI-compatible server on the same host, such as llama.cpp's `llama-server`, Ollama or vLLM. The deployment configures the model ID the server lists at `/v1/models` and, optionally, the weights digest. The harness is available only while the server lists that model. Every run record keeps the model ID and the digest, so work a local agent did names the model that did it.

The harness has no address of its own. Its requests go through the network port's `local-inference` destination, which is declared with loopback scope. The deployment policy binds it, for example to `http://127.0.0.1:11434` for Ollama. The [egress guard](glossary.md#egress-guard) refuses a binding or a resolved address that leaves the host, so isolated sites can bind it. Without a binding, the harness reports itself unavailable.

An agent definition's model requirement decides which harnesses may run it:

- **local** admits harnesses that keep prompts on this host.
- **remote** admits provider harnesses.
- **any** admits every harness.

The deterministic fixture uses no model and meets every requirement. A harness that does not say where it sends prompts counts as remote, so a new adapter cannot run a local agent by omission.

For a server the deployment runs itself, the harness records the configured digest as unverified and does not check it against the served weights. The [model server plugin](../plugins/model-server/README.md) starts llama.cpp `llama-server` or vLLM through the [process port](glossary.md#process-port), on the address the deployment policy binds to `local-inference`. It hashes the weights before every start, and its harness records the measured digests as verified.

## Run supervision

The run supervisor bounds every provider's runs the same way ([agents](agents.md#runs)):

- **Tool calls.** Duplicate callbacks for one call ID share one result. Reusing a call ID with different arguments fails.
- **Questions and approvals.** At most one is pending per run, and each has one request ID. Each accepts one answer and times out after five minutes by default.
- **History.** A run keeps its recent events. A stale cursor or a slow subscriber gets an explicit reset.
- **Storage failure.** A failed run-store write aborts the run instead of reporting success.

## Use

Run the deterministic tests:

```sh
bun run test:harness
bun test packages/host/test/providers.test.ts
```

The tests send no credentials or records over the network and cover:

- the sign-in flow against a local signed OIDC server;
- replay and persistence failures and timeouts;
- partial-output failure and idempotent tool dispatch;
- JSON-RPC errors and cancellation of process trees;
- the real Claude SDK MCP bridge and a mocked AI SDK stream.

The opt-in live probe sends one synthetic prompt and a read-only tool through the Codex, Claude or AI SDK adapter. It runs only with explicit permission, with the model and credentials from a secure environment, and is not part of normal checks.

```sh
AGENT_LIVE_ALLOWED=1 bun packages/agents/scripts/live-smoke.ts claude
```

A new adapter documents its runtime version, credential source, tool boundary, success rule, cancellation and resume storage. It adds fixtures for success, partial failure and tool rejection. Platform and live checks run separately.

## Limits

- The web frame's accounts panel offers the deterministic, Codex, Claude and AI SDK harnesses. It does not offer the local harness; an agent run started without a harness uses the model server's.
- Only tests use the generic OIDC connection.
- The model server does not manage Ollama, which keeps models in its own store, so an Ollama run is unverified.

## References

- [Agents](agents.md)
- [Desktop](desktop.md)
- [Security and compliance](security-and-compliance.md)
- [Implementation status](implementation-status.md#agents-and-providers)
- [Codex app-server protocol](https://developers.openai.com/codex/app-server/)
- [ChatGPT dynamic registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [ChatGPT profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [ChatGPT token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
- [Codex app-server with ChatGPT plan tokens](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Claude Agent SDK TypeScript](https://github.com/anthropics/claude-agent-sdk-typescript)
- [AI SDK streaming reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- [Native keyring adapter](https://github.com/Brooooooklyn/keyring-node)
- [Agents](agents.md#local-models)

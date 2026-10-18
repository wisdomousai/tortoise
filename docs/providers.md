# Providers and account connections

The application runtime stays the only authority over business data. A harness gets the catalog's tool definitions and a tool port. It cannot choose who it acts as, grant itself access, or replace the captured resource context. Tool calls take the same path as HTTP, CLI and MCP calls, so new behavior belongs in the catalog, not in provider-specific code. Runs are described in [agent harnesses](agents.md).

A harness streams text, progress, tool and native-session events. A run succeeds only when the adapter has validated the provider's terminal result and every tracked tool call has finished. Native session IDs are kept for resuming. Credentials and prompts never go into run records.

## Adapters

| Harness         | Runtime                                      | Funding chosen by the host | Native resume | Questions and approvals                                    |
| --------------- | -------------------------------------------- | -------------------------- | ------------- | ---------------------------------------------------------- |
| `deterministic` | A local declarative fixture                  | None                       | No            | Both, with timeouts                                        |
| `codex`         | The pinned Codex app-server over JSON-RPC    | A ChatGPT plan profile     | Thread ID     | Native questions; shell and file approvals always declined |
| `claude`        | The Claude Agent SDK and a pinned executable | An Anthropic API key       | Session ID    | Neither                                                    |
| `ai-sdk`        | AI SDK streaming with application tools      | An OpenAI API key          | No            | Neither                                                    |
| `local`         | AI SDK chat completions on a loopback server | None                       | No            | Neither                                                    |

Each adapter is limited to application tools. Codex runs with shell, edit and search disabled, a read-only sandbox, and every command or file approval declined. Its protocol version is pinned, because dynamic tools are still experimental. Claude sees only the application's MCP tools, with no built-in tools and no ambient settings. AI SDK rejects string model aliases, so an ambient gateway credential cannot be picked up. A product that adds shell or file tools defines its own authorization boundary.

Native executables and provider home directories are absolute paths owned by the host. A provider process gets an allowlisted environment plus the credentials injected explicitly for it. It never inherits API keys, developer CLI configuration or the developer's `PATH`. The desktop build compiles the Claude SDK into the service, so no separate Node runtime is needed ([desktop](desktop.md)).

## Local models

The `local` harness runs an OpenAI-compatible server on the same host, such as llama.cpp's `llama-server`, Ollama or vLLM. The deployment configures the model ID the server lists at `/v1/models` and, optionally, the weights digest. Every run record keeps both, so work a local agent did names the model that did it. The digest is the configured value; the harness does not check it against the served weights.

The harness has no address of its own. Its requests go through the network port's `local-inference` destination, which is declared with loopback scope. The site policy binds it, for example to `http://127.0.0.1:11434` for Ollama, and the egress guard refuses a binding or a resolved address that leaves the host. Isolated sites can bind it, because it is loopback. Without a binding, the harness reports itself unavailable.

An agent definition's model requirement decides which harnesses may run it. `local` admits the local harness and harnesses with no model (the deterministic fixture and jobs). `remote` admits provider harnesses. `any` admits all. A harness that does not say where it sends prompts counts as remote, so a new adapter cannot run a `local` agent by omission. Triggers choose their agent's harness this way. The host's run panel does not offer the local harness yet.

## ChatGPT connection

The connection follows the documented dynamic public-client flow. The authority starts its loopback callback before it begins sign-in.

- **Enrollment.** A new enrollment registers with the application name and an opaque host ID kept in the OS vault. A returning profile uses its issued client ID.
- **Each attempt** lives five minutes and uses one-time state, a nonce and PKCE.
- **The callback** checks the state, the exact loopback target and the client ID. It exchanges the code, then verifies the ID token's signature, issuer, audience, expiry and nonce on the server. A returning sign-in must match the stored subject.
- **Authorization URLs** are never logged, and they carry no ID-token hint, so tokens never reach the renderer.
- **Inference** needs both the `resource.invoke` and `chatgpt.tokens.use.direct` scopes. A verified identity without them is kept as a disabled profile. A model list is not evidence that inference or billing works.

Profile listing and status return safe metadata only. Credentials are available only inside the authority, and never for disconnected, ungranted or expired profiles; they are never exposed to the renderer. Token refresh is serialized through the whole rotating write. One owner per credential namespace: the service uses a vault namespace per workspace under its workspace lock, and any host that shares profiles across processes needs a single refresh owner.

Logout removes access, refresh and ID tokens locally and attempts revocation at the provider. It reports honestly when revocation could not be confirmed, and no local token remains as a fallback.

A generic OIDC connection is available for explicitly enrolled providers. It never reuses ChatGPT's bootstrap client, and it never trusts an unverified token.

## Credential storage

The OS credential vault runs in the authority, independently of Electron. It uses Keychain on macOS, the credential store on Windows, and Secret Service on Linux, which needs a desktop D-Bus session. A locked, denied or missing store is an error. It never falls back to files, the database, environment variables or a test vault. A keyring may show its own unlock prompt during an explicit account action, but startup and status checks never probe it. The packaged build embeds the native addon instead of loading it dynamically. The in-memory vault exists for tests only.

## Run limits

- **Tool calls.** Each tool call gets an idempotency key scoped to its run. Duplicate callbacks share one result, and reusing a call ID with different arguments fails.
- **Questions and approvals.** Each has one request ID, accepts one answer, and times out after five minutes by default.
- **Output** is bounded and redacted for known secret patterns, including across streamed chunks.
- **History.** A run keeps its recent events. A stale cursor or a slow subscriber gets an explicit reset.
- **Storage failure.** A failed run-store write aborts the run instead of reporting success.

Native adapters close their child processes on completion and cancellation, as a whole process tree. This manages lifetime; it is not a sandbox against a hostile executable. Process-tree behavior on Windows and Linux needs those platforms' smoke tests.

## Verification

Deterministic tests send no credentials or records over the network. They cover:

- the sign-in flow against a local signed OIDC server;
- replay and persistence failures and timeouts;
- partial-output failure and idempotent tool dispatch;
- JSON-RPC errors and cancellation of process trees;
- the real Claude SDK MCP bridge and a mocked AI SDK stream.

An opt-in live probe sends one synthetic prompt and a read-only tool through a chosen adapter. It runs only with explicit permission, model and credentials supplied through a secure environment, and it is not part of normal checks. A passing fixture or packaged startup proves nothing about live consent, billing, entitlement or quality.

A new adapter documents its runtime version, credential source, tool boundary, success rule, cancellation and resume storage. It adds fixtures for success, partial failure and tool rejection. Platform and live checks are run separately, and skipped ones are recorded as skipped.

## References

- [Codex app-server protocol](https://developers.openai.com/codex/app-server/)
- [ChatGPT dynamic registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [ChatGPT profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [ChatGPT token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
- [Codex app-server with ChatGPT plan tokens](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Claude Agent SDK TypeScript](https://github.com/anthropics/claude-agent-sdk-typescript)
- [AI SDK streaming reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- [Native keyring adapter](https://github.com/Brooooooklyn/keyring-node)

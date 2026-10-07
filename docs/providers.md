# Agent harnesses and account connections

The application runtime remains the only authority for business data. A harness receives the catalog's tool definitions and a `ToolPort`; it cannot choose an acting principal, issue itself a grant or replace the captured resource context. Tool calls enter the same application execute path as HTTP, CLI and MCP calls. Register capabilities in the application catalog rather than adding provider-specific mutations.

Start with `packages/agents/src/types.ts`, `supervisor.ts` and `apps/service/src/providers.ts` when extending a provider. `Harness.run()` produces an async stream of text, progress, tool and native-session events. Successful iterator completion is meaningful only after the adapter validates its provider's terminal result. The supervisor also waits for tracked application calls before persisting success. Native IDs belong in `resumeData`; credentials and prompts do not belong in run receipts.

## Available adapters

| Harness         | Runtime                                                          | Funding selected by the host                              | Native resume     | Questions / approvals                                  |
| --------------- | ---------------------------------------------------------------- | --------------------------------------------------------- | ----------------- | ------------------------------------------------------ |
| `deterministic` | Local declarative fixture                                        | None                                                      | No                | Both, with timeouts                                    |
| `codex`         | Pinned native Codex app-server, newline JSON-RPC                 | Explicit ChatGPT plan profile in service integration      | Native thread ID  | Native questions; shell/file approvals always declined |
| `claude`        | Claude Agent SDK JavaScript plus pinned native Claude executable | Explicit Anthropic API key                                | Native session ID | Neither exposed                                        |
| `ai-sdk`        | AI SDK streaming model and application tools                     | Explicit configured OpenAI API key in service integration | No                | Neither exposed                                        |

The Codex adapter initializes the experimental API, registers dynamic application tools, disables its shell/edit/search feature profile, requests a read-only sandbox and never approves command or file changes. Its protocol version is pinned because dynamic tools remain experimental. The Claude adapter uses a real SDK MCP server and allows only the declared application MCP names, with built-in tools empty, strict MCP configuration and settings sources empty. The AI SDK adapter uses `streamText`, `tool`, `jsonSchema`, `isStepCount` and the current result stream; string model aliases are rejected so an ambient gateway credential cannot be selected. These are deliberately limited application-tool profiles. A product that adds filesystem or shell tools must define a separate explicit authorization boundary.

Native executables and writable provider homes are host-owned absolute paths. The provider child environment is an allowlist plus explicitly injected credentials. It does not inherit provider API keys, developer CLI configuration or a developer PATH. The packaged native Claude executable runs directly; its JavaScript SDK is compiled into the Bun service, so the desktop does not require a separately installed Node runtime. See [desktop packaging](desktop.md) for the target matrix and platform gates.

## ChatGPT connection

`ChatGptAccountConnection` implements the documented dynamic public-client flow. The authority starts its loopback callback listener before calling `begin(sessionId, profileId?)`. New enrollment uses `dynamic_agent_client`, the stable application name and an opaque host UUID saved in the OS vault. Returning profiles use their issued client ID and may supply their own stored identity/email hint. Each attempt has a five-minute lifetime, random session-bound state and nonce, and PKCE S256. Never log the authorization URL: returning-account URLs can contain an ID-token hint.

The callback consumes state once, checks the exact loopback target and issued client ID, exchanges the code with the same redirect and resource, then verifies the ID-token signature, issuer, audience, expiry and nonce server side. Returning sign-in must match the stored verified subject. The optional ID-token hint is omitted from authorization URLs so stored provider tokens never enter renderer state or navigation URLs. The token response's granted scopes control inference; this host requires both `resource.invoke` and `chatgpt.tokens.use.direct`. A valid identity without that grant is retained as a disabled profile. Provider model listing is a catalog, not evidence that inference or plan billing succeeded.

The public methods `profiles()`, `complete()` and `refresh()` return safe metadata. `credentials(profileId)` is authority-only and refuses disconnected, ungranted or expired profiles. Never export it over renderer IPC or a browser endpoint. Refresh exchanges are serialized through the entire rotating-token write. Each credential namespace must have one `ChatGptAccountConnection` owner: the service uses a workspace-specific vault namespace and its OS-held workspace authority lock. If a future host shares a profile across workspaces or processes, it must centralize refresh ownership rather than instantiate competing writers.

Logout removes access, refresh and ID tokens locally while retaining the issued registration and host identity. It discovers the provider revocation endpoint and attempts refresh-token revocation; `revocationConfirmed: false` honestly reports unavailable or rejected revocation. No local token remains available for fallback. New-profile index writes receive best-effort cleanup if the vault fails between writes; OS vault entries are not a multi-entry transaction.

The generic `OidcAccountConnection` is also available for explicitly enrolled trusted provider configuration. It is separate from ChatGPT dynamic enrollment; do not substitute the bootstrap client ID into a token exchange or invent identity by decoding an unverified JWT.

## Credential storage

`OsCredentialVault` uses `@napi-rs/keyring` 2.1.0 from the Bun authority, independently of Electron. macOS uses Keychain and Windows uses the native credential store. Linux is explicitly configured with `linux.store = 'secret-service'`: a working desktop D-Bus session and Secret Service implementation are required for persistent credentials. The package's automatic kernel-keyring fallback is disabled. A locked, denied or unavailable OS store propagates an error; it never selects plaintext files, SQLite, environment variables or the test vault as a fallback. A keyring may present its own unlock/permission UI during explicit account operations. Startup, availability and generic status must not probe it.

`MemoryCredentialVault` is an explicit ephemeral fixture dependency. `installNativeCredentialBinding()` belongs only in the packaged composition root, before importing the service; it supplies the target native addon embedded by Bun instead of relying on npm's dynamic platform loader.

## Run lifecycle and recovery

The supervisor persists queued/running/waiting states and terminal `succeeded`, `failed`, `cancelled` or `interrupted` receipts. Runs in one conversation execute serially. A question or approval has one request ID, accepts one response and defaults to a five-minute timeout. Cancellation aborts application work and the provider adapter; it cannot undo mutations already committed. A harness failure aborts outstanding tool work. Application handlers must check the signal again at their commit boundary.

Each tool invocation gets a run-prefixed idempotency key. Duplicate callbacks with identical arguments reuse one promise; reusing an ID with different arguments fails. Output has per-chunk and per-run bounds, explicit-secret redaction and common token-pattern redaction. Streamed text is redacted across deltas: a tail that could still begin a secret is held back until the next delta or event. Redaction is a secondary guard, not permission to feed credentials to models or tools; secrets must not reach a run's input or tools in the first place. Only the latest 256 run events are retained. A cursor older than the retained history and a slow subscriber both fail explicitly and require a fresh snapshot. Store write failure aborts work, closes delivery and exposes an in-memory `RUN_STORE_FAILED` receipt rather than reporting success. Restart recovery marks unsettled persisted runs interrupted; it does not silently replay mutations or infer success from partial text.

Native adapters close their child processes at completion and cancellation. POSIX provider children run in an isolated process group; Windows invokes the absolute system `taskkill /T /F` path. Claude's custom spawner preserves the SDK stdin-EOF grace window before tree termination. This is lifecycle management, not an OS sandbox against a hostile executable. Ordinary descendant cancellation is tested on the development macOS host; Windows/Linux process behavior requires their platform smoke gates.

## Verification and live probes

Run `bun run typecheck` and `bun test packages/agents/test apps/desktop/test`. Deterministic tests exercise signed local OIDC responses, PKCE/client-ID/resource binding, replay and persistence failures, question/approval timeout, partial-output failure, idempotent ToolPort dispatch, JSON-RPC failure/timeout, native subtree cancellation, the real Claude SDK MCP bridge and an AI SDK V4 mocked model stream. They send no provider credentials or user records over the network. Browser/service acceptance elsewhere in the repository verifies the shared business tool path.

`packages/agents/scripts/live-smoke.ts` is an opt-in synthetic transport probe, excluded from ordinary tests. It requires `AGENT_LIVE_ALLOWED=1`, an explicit `AGENT_MODEL`, and explicit credentials (`AGENT_API_KEY`, or `AGENT_ACCESS_TOKEN` plus `AGENT_APP_NAME` for ChatGPT). Native probes also require an absolute `AGENT_NATIVE_EXECUTABLE`. Run `bun packages/agents/scripts/live-smoke.ts codex`, `claude` or `ai-sdk` after supplying those values through a secure host environment. It sends one fixed synthetic prompt and a synthetic read-only ping tool, prints only status/call counts, and removes its temporary provider home. It is not run as part of this implementation. A successful local fixture or packaged startup does not establish live account consent, billing, entitlement, provider quality or release readiness.

When adding an adapter, document its exact runtime/SDK version, credential source, tool boundary, terminal-success rule, cancellation behavior and resume storage. Add protocol fixtures for its success, partial-output failure and tool rejection. Run the applicable platform and opt-in provider gates separately, and record skipped gates as skipped.

## Primary references

- [Codex app-server protocol](https://developers.openai.com/codex/app-server/)
- [ChatGPT dynamic registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [ChatGPT profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [ChatGPT token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
- [Codex app-server with ChatGPT plan tokens](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Claude Agent SDK TypeScript source and declarations](https://github.com/anthropics/claude-agent-sdk-typescript)
- [AI SDK streaming reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- [Native keyring adapter and Linux backend selection](https://github.com/Brooooooklyn/keyring-node)

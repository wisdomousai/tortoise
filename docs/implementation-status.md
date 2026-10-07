# Implementation and verification status

Checked on 7 October 2026. This ledger distinguishes implemented code, deterministic checks, native execution and live provider evidence. It describes the working source tree; no public release has been made.

## Implemented

- Pure typed capability/module contracts with validated composition, JSON Schema and generated OpenAPI, MCP names, operation reference and workflow index.
- One authorized CQRS runtime, memory/SQLite adapters, optimistic revisions, scoped idempotency, atomic receipts/journal, consistent snapshots and replay.
- CASL operation/object/row/field decisions, a bounded SQL scope translator, current grants and permission-aware output projection.
- Local authority ownership, loopback security, session bootstrap, HTTP/SSE, CLI and real MCP stdio bridge.
- Shared React frontend and Electron host, live updates, dirty-draft conflicts, scoped UI sessions and version-pinned target capture.
- Supervisor, deterministic workflow, Codex, Claude and AI SDK adapters, questions/approvals, cancellation and interrupted-run recovery.
- Explicit ChatGPT dynamic registration, identity validation, protected profile/refresh/logout, account model catalog and separate API-key funding.
- Deterministic source scaffolder, developer setup/extension skill, architecture guides and generated references.

## Verified locally

| Gate             | Evidence                                                                                                                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source           | Typecheck, browser dependency boundaries, generated-artifact drift and production web build pass.                                                                                                                                                                                             |
| Behavioral suite | `bun run check`: 105 tests passed, 539 assertions, zero failures. The recursive scaffold gate is deliberately skipped there and passes separately below.                                                                                                                                      |
| Persistence      | Memory/SQLite conformance, rollback, replay, actual process death before/after commit and OS-lock crash release pass.                                                                                                                                                                         |
| Surface parity   | Direct, HTTP, CLI subprocess and MCP protocol scenarios agree on results, denial and idempotency.                                                                                                                                                                                             |
| Browser          | Chromium with a separate MCP process: agent changes appear without refresh, UI writes are queryable, drafts survive conflicting changes and deterministic work completes.                                                                                                                     |
| Scaffold         | `bun run test:scaffold:full`: 3 tests passed, 20 assertions. Fresh export, frozen public-dependency install, format/typecheck, five generated artifacts, build, tests, app identity and a newly added capability all pass. Native install scripts are disabled in this isolated source check. |
| macOS arm64      | Final-source native stage, unsigned directory package, native version/compiled service smoke and actual Electron owned/attached lifecycle tests pass. The combined final Playwright run passed all 3 tests with zero skips.                                                                   |
| Skill            | Skill metadata validator and isolated add-capability exercise pass.                                                                                                                                                                                                                           |

## Explicitly unverified

Live ChatGPT consent, model inference, real token refresh/revocation, Claude inference and AI SDK inference were not run. No existing provider credentials were discovered or reused. Signed token fixtures and native protocol fixtures establish local behavior only.

Native credential-vault set/get/delete and locked-store prompts remain platform checks. Windows x64, Linux x64 and macOS x64 execution are configured in CI but were not run on this macOS arm64 host. The workflow has not been pushed or executed remotely. Signing, notarization, installers, updates, public package publication and deployment remain outside this delivery.

## Reference implementation limits

SQLite persists complete JSON snapshots; it is intended for small local workspaces. The materialized-state port is storage-layout independent but is not a universal transaction-bound ORM. The client uses conservative re-querying rather than indexed invalidation/coalescing. The journal/receipts have no pruning policy. UI intents are ephemeral authenticated host interactions, separate from durable business operations.

Run discovery/control is scoped to the initiating principal, workspace and delegation; nested run delegation is rejected in this reference. Model text cannot be field-redacted as a typed domain response. The service suppresses historical run output and target context after an authorization-generation change; new business queries still use current policy. Provider subprocess isolation is a limited application-tool profile rather than an OS security boundary against malicious binaries.

Use [development and testing](development-and-testing.md) and [desktop packaging](desktop-packaging.md) to reproduce the checks. See [provider documentation](providers.md) before configuring a live account.

## Final local artifact

The verified immutable stage is `artifacts/desktop/accepted-darwin-arm64`. Its unsigned application is under `packaged/mac-arm64/Project Workspace.app`. Artifacts are ignored by Git and can be reproduced with the packaging scripts.

- Environment: macOS arm64, Bun 1.4.0, TypeScript 7.0.2, Playwright 1.63.0, Electron 44.6.0.
- Compiled service SHA-256: `a36a3c737667b5ad603ac42954559993ccffd380be43720420837dd58c89647b`.
- Native version smoke: Codex CLI 0.160.1; Claude Code 2.1.292 from SDK distribution 0.3.292.
- Native acceptance used a temporary workspace containing spaces and a minimal `/usr/bin:/bin` PATH. It checked live external writes, renderer isolation, persisted reopening, owned shutdown and survival of an attached authority.
- Browser acceptance additionally checked separate MCP stdio interaction, draft conflicts and an agent question/answer.
- Both setup and generated application skill metadata validate. Local documentation links resolve.

These results apply to this implementation's local checks. No remote CI, provider login, billing/entitlement, signing or publication result is implied.

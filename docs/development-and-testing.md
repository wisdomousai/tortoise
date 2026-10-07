# Development and testing

Install the pinned dependencies with `bun install --frozen-lockfile`. The root workspace contains browser-safe contracts/client/React packages, authority-only adapters/runtime, example domain modules and agent harnesses. Feature authoring follows [capability-authoring.md](capability-authoring.md); permission behavior is specified in [authorization.md](authorization.md).

```sh
bun run typecheck
bun run generate
bun run check:generated
bun run check:boundaries
bun test
bun run build
```

`generate` writes deterministic contract, operation, workflow and OpenAPI references. `check:generated` fails when those files drift. `check:boundaries` checks imports and bundles the browser dependency graph to reject transitive host dependencies. A successful browser build is separate from a browser interaction or packaged desktop launch.

For focused work, use these scripts:

| Command                                       | Scope                                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `bun run test:unit`                           | Contracts, runtime, client ordering and UI context helpers.                                                            |
| `bun run test:conformance`                    | Policy, repositories, adapters and example-domain scenarios.                                                           |
| `bun run test:service`                        | HTTP boundary and actual loopback authority behavior.                                                                  |
| `bun run test:harness`                        | Provider-independent harness/supervision fixtures.                                                                     |
| `bun run test:e2e`                            | Real browser acceptance, configured by Playwright.                                                                     |
| `bun run test:package`                        | Desktop/sidecar packaging checks available on the current platform.                                                    |
| `bun run test:scaffold`                       | Deterministic export and overwrite/privacy safeguards.                                                                 |
| `SCAFFOLD_ACCEPTANCE=1 bun run test:scaffold` | Fresh source export, frozen pinned dependency installation, independent typecheck/build/tests and an added capability. |

The complete scaffold acceptance is opt-in so exported tests do not recursively export/install themselves. Its install uses the pinned public dependencies in the exported lockfile. No unpublished framework package or access to the original checkout is required.

Service tests bind loopback ports. A sandbox that blocks listening sockets can report `EADDRINUSE` even for port zero; run the authorized local integration checks in an environment that permits loopback listeners. Subprocess tests use temporary workspaces and terminate only processes they start.

Native acceptance requires an already packaged application. Set `DESKTOP_EXECUTABLE` to its executable and run `bunx playwright test tests/e2e/desktop.pw.ts`. Without that variable the two native tests explicitly skip. They launch real Electron with a minimal runtime `PATH`, use isolated workspaces whose paths contain spaces, verify external changes in the native window and renderer isolation, reopen persisted data after owned-sidecar shutdown, and confirm that closing an attached frontend preserves a pre-existing authority. Rerun against the final packaged bytes after any service, frontend or desktop change.

## Behavioral evidence

Contract tests compose independently authored modules, retain inferred input/output types, reject missing handlers/dependencies/workflow references and verify deterministic artifact generation. Runtime tests exercise rollback on invalid output, current/proposed authorization, duplicate requests, conflicting revisions, cancellation, bound grants and query purity.

Policy tests compare CASL object checks with memory scopes and parameterized SQLite queries. Domain scenarios run through both persistence adapters with owner/editor/viewer identities, resource-limited grants, protected fields, scoped counts/pages and permission changes. Independent security scenarios interrupt awaited output projection with cancellation, grant expiry or changed policy and verify that no data, receipt or journal entry commits.

Durability checks kill isolated subprocesses before and after commit. The former retains no partial state; the latter retains business changes, receipt and journal for replay after notification loss. Ownership checks run competing processes, a symlink alias and a killed owner to verify OS lock behavior.

HTTP checks cover Host/Origin validation, single-use launch credentials, revoked sessions, body identity spoofing, cookie write validation, session-bound cursors and private-field projection. Real host tests verify delegated agent runs cannot expand their initiating grant and that run access is scoped by principal and workspace. Query/subscription-gap checks commit after a snapshot, then subscribe from its cursor and observe the intervening change. Revocation checks assert a reset without newly forbidden resource identifiers.

Controlled client iterators exercise responses that finish out of order, revocation while a refresh is pending, stale errors, and unsubscribe while a response is pending. UI context tests keep captured targets stable across selection changes, reject cross-session access, fence delayed updates and exercise intent acknowledgement/expiry.

MCP/CLI conformance must invoke the actual transport adapter and compare business results and structured error codes with HTTP/direct invocation. Catalog discovery is insufficient evidence: a listed operation still needs invocation authorization. Browser/Electron acceptance additionally verifies that external writes change open views without refresh and that a dirty editor preserves its draft while reporting a revision conflict.

## Provider and release gates

Fixture tests prove adapter/protocol behavior for controlled events; they do not prove provider login or inference access. Provider checks are opt-in and require an explicitly configured account or credential. Never discover credentials from unrelated configuration or silently switch an exhausted plan to a chargeable API key. OS credential storage availability needs its own platform check; the in-memory vault is an explicitly selected fixture, not a fallback.

Record implementation, local test results, CI results, browser/desktop observations, provider checks and release status separately in the implementation status document. An exported source tree, bundled sidecar or passing suite is not a signed or published release. Report skipped acceptance tests and unsupported platform/provider features explicitly.

CI runner labels follow the [GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Bun setup follows the [official CI guide](https://bun.sh/guides/runtime/cicd). The configured workflow has not been executed remotely in this delivery.

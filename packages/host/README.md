# @agent-native/host

The generic authority process. It runs exactly one application definition supplied by content and owns everything an application should not rewrite: workspace ownership and storage, launch and sessions, HTTP/SSE, embedded MCP, the application CLI, agent run supervision, provider accounts, background delivery and observers. It also applies one security layer to every application: the site policy and its hardening floor, the audit log, the egress guard and the `security`/`audit` CLI verbs. The host names no domain.

Layer: framework (`packages/*`). The starter's `apps/service` calls it; content calls only `defineManifest` and `defineApplication`.

## Primitives

- [Application](../../docs/primitives.md#application): `defineManifest`, `ApplicationManifest`, `defineApplication`, `ApplicationDefinition`, `ApplicationConnections`.
- [Host](../../docs/primitives.md#host): `startHost`, `serve`, `createCli`, `openEmbeddedAuthority`, `combineIntegrations`, `readStarterConfig`, `loadApplication`, `loadManifest`, `openSecurity`, `securityFromEnvironment`, `assertIdentity`, `hostComponents`, `deploymentCatalog`.
- [Remote query](../../docs/primitives.md#remote-query): `ApplicationDefinition.sources` binds each remote target to a `RemoteSource`, which the host hands to the runtime. A target without a source answers `unavailable`.
- [Assurance bundle](../../docs/primitives.md#assurance-bundle): `assuranceCommand` adds `security check|export` and `audit verify|report` to every application's CLI.

Each example's `manifest.ts` and `application.ts` show the two content entrypoints, for example [`examples/project-tasks/application.ts`](../../examples/project-tasks/application.ts). [ADR 005](../../docs/decisions/005-framework-shell-content.md) records the layering.

## Entrypoints

| Import                                 | Runs in     | Contents                                                                                                            |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/host`                   | server only | The public API listed under Primitives.                                                                             |
| `@agent-native/host/*`                 | server only | One source file, listed below. Only `manifest` is browser-safe.                                                     |
| `@agent-native/host/manifest`          | browser     | `defineManifest`: an application's id, title and modules. Imports no host code.                                     |
| `@agent-native/host/application`       | server only | `defineApplication`, `createApplicationRuntime`, `ConnectContext`, `Observer`.                                      |
| `@agent-native/host/config`            | server only | `app.config.json` reading and runtime resolution of the configured application (`loadApplication`, `loadManifest`). |
| `@agent-native/host/serve`             | server only | `serve`: run the HTTP authority until SIGINT/SIGTERM; the first stdout line is a `listening` JSON record.           |
| `@agent-native/host/cli`               | server only | `createCli`: catalog-derived CLI with `serve`, `mcp`, `drain`, `sync` and attached or `--embedded` authorities.     |
| `@agent-native/host/embedded`          | server only | `openEmbeddedAuthority`, `workspaceStorage`, `LOCAL_OWNER`, `LOCAL_WORKSPACE`.                                      |
| `@agent-native/host/security`          | server only | Site policy loading, egress guard, audit log and identity floors for one deployment.                                |
| `@agent-native/host/components`        | server only | The host's own declared requirements (listener, audit forwarder) and `deploymentCatalog`.                           |
| `@agent-native/host/providers`         | server only | `createProviderAccess`: provider accounts, API-key funding and harness construction.                                |
| `@agent-native/host/runtime-manifest`  | server only | Digest checks for the packaged service and its shipped site policy.                                                 |
| `@agent-native/host/optional-packages` | server only | Packages loaded only when an optional adapter is configured; standalone builds keep them external.                  |

`host`, `integrations` and `assurance-cli` are also importable by path; prefer the root export.

Four entries are thin composers over a folder of parts that are imported only from inside the package:

- `src/host/`: `startHost`'s steps (authority, agents, listener, connection files, cleanup stack) and its routes (`routes/` with shutdown, UI sessions and runs), plus the SQLite run store and the agent tool port.
- `src/providers/`: shared `ProviderState`, owner scope and vault namespacing, profile selection, the verified native runtime, lazy harnesses, the provider account routes, the model catalog and the OAuth callback. The default `fetch` is chosen only in `providers.ts`, which is the egress-exempt file; the parts call it through the state.
- `src/security/`: the audit channel (log, forwarder, egress guard and child proxy), the syslog sink, attestation records and the executable digest.
- `src/cli/`: one module per command group (`serve`, `mcp`, `sync`/`drain`, operations) and shared argument parsing.

## Trust boundary

An application definition is trusted code: its policy, handlers and connections run inside the authority with the host's privileges. Only callers are untrusted. The host derives every `ExecutionContext` from a session, connection file or grant file. Launch credentials are single-use and expire; connection files are written for local clients and are credentials.

One authority per workspace, enforced by the same OS lock for a serving and an embedded host. Embedded authorities never start observers. Observers start only after the host listens, and a failed start stops the ones already running. The host refuses to start below its site policy's hardening floor rather than weaken identity, transport or audit. Server code reaches the network only through the egress guard; `providers.ts` falls back to global `fetch` only when constructed without one, an exemption listed in `scripts/boundary-rules.ts`.

Provider credentials pay for inference and never grant workspace access. Startup and status never read the vault.

Environment the host reads: `WORKSPACE_PATH`, `AGENT_NATIVE_APPLICATION`, `AGENT_NATIVE_SITE_POLICY`, `AGENT_NATIVE_AUDIT_LOG`, `AGENT_NATIVE_CONNECTION`, `AGENT_NATIVE_GRANT_FILE`, `AGENT_RUNTIME_MANIFEST`.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/adapters`, `@agent-native/client`, `@agent-native/agents`, `@agent-native/integration`, `@agent-native/egress`, `@agent-native/event-log`, `@agent-native/assurance`, `@agent-native/react` (types only). External: `@modelcontextprotocol/sdk`, `@ai-sdk/openai`. It must never import `apps/*` or `examples/*`; `bun run check:boundaries` fails if it does.

## Tests

```sh
bun test packages/host
bun run test:service
```

`test/providers.test.ts` covers provider access: no credential reads at startup, single-use OAuth callbacks bound to their session, explicit API-key funding and no leaked provider error text. Host behavior against real operations is tested in content: each example's `test/application.test.ts`, and `examples/project-tasks/test/host.test.ts`, `hardening.test.ts` and `security-conformance.test.ts` ([P3](../../docs/principles.md#p3--authority-comes-from-trusted-context-never-from-input-and-is-enforced-at-commit), [P11](../../docs/principles.md#p11--framework-starter-and-content-are-separate-layers-and-an-authority-runs-one-application), [P13](../../docs/principles.md#p13--the-application-reaches-only-what-it-declares-and-the-site-binds-and-records-what-it-does)).

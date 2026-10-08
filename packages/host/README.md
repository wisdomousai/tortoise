# @agent-native/host

The generic authority process. It runs exactly one application definition supplied by content and owns everything an application should not rewrite: workspace ownership and storage, launch and sessions, HTTP/SSE, embedded MCP, the application CLI, agent run supervision, provider accounts, background delivery and observers. The host names no domain and no security concept. It is a kernel: what crosses the process boundary goes through ports with deny-by-default defaults, and the application's [plugins](../../docs/primitives.md#host-plugin) provide more, such as `@agent-native/security`.

Layer: framework (`packages/*`). The starter's `apps/service` calls it; content calls only `defineManifest` and `defineApplication`, and plugins only `definePluginManifest` and `defineHostPlugin`.

## Primitives

- [Application](../../docs/primitives.md#application): `defineManifest`, `ApplicationManifest`, `defineApplication`, `ApplicationDefinition`, `ApplicationConnections`.
- [Host](../../docs/primitives.md#host): `startHost`, `serve`, `createCli`, `openEmbeddedAuthority`, `combineIntegrations`, `readStarterConfig`, `loadApplication`, `loadManifest`, `hostComponents`, `deploymentCatalog`, `deploymentRequirements`.
- [Host plugin](../../docs/primitives.md#host-plugin): `definePluginManifest`, `PluginManifest`, `PluginSetting`, `PluginModules`, `defineHostPlugin`, `HostPlugin`, `AnyHostPlugin`, `PluginInstance`, `PluginOpenContext`, `PluginStartContext`, `PluginCommand`, `HostPorts`, `NetworkPort`, `IngressPort`, `IdentityPort`, `defaultPorts`, `readPluginSettings`, `PluginSettings`.
- [Remote query](../../docs/primitives.md#remote-query): `ApplicationDefinition.sources` binds each remote target to a `RemoteSource`, which the host hands to the runtime. A target without a source answers `unavailable`.
- [Assurance bundle](../../docs/primitives.md#assurance-bundle): `deploymentCatalog` is the composed catalog plus host components the generators read.

Each example's `manifest.ts` and `application.ts` show the two content entrypoints, for example [`examples/project-tasks/application.ts`](../../examples/project-tasks/application.ts). [ADR 005](../../docs/decisions/005-framework-shell-content.md) records the layering and [ADR 010](../../docs/decisions/010-host-plugins.md) the plugin kernel.

## Entrypoints

| Import                                 | Runs in     | Contents                                                                                                                   |
| -------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/host`                   | server only | The public API listed under Primitives.                                                                                    |
| `@agent-native/host/*`                 | server only | One source file, listed below. Only `manifest` and `plugin-manifest` are browser-safe.                                     |
| `@agent-native/host/manifest`          | browser     | `defineManifest`: an application's id, title and modules. Imports no host code.                                            |
| `@agent-native/host/plugin-manifest`   | browser     | `definePluginManifest`, `PluginSetting`: a plugin's id, modules, components and settings. Imports no host code.            |
| `@agent-native/host/plugin`            | server only | `defineHostPlugin`, the port types (`HostPorts`, `NetworkPort`, `IngressPort`, `IdentityPort`) and the lifecycle contexts. |
| `@agent-native/host/application`       | server only | `defineApplication`, `createApplicationRuntime`, `ConnectContext`, `Observer`.                                             |
| `@agent-native/host/config`            | server only | `app.config.json` reading and runtime resolution of the configured application (`loadApplication`, `loadManifest`).        |
| `@agent-native/host/serve`             | server only | `serve`: run the HTTP authority until SIGINT/SIGTERM; the first stdout line is a `listening` JSON record.                  |
| `@agent-native/host/cli`               | server only | `createCli`: catalog-derived CLI with `serve`, `mcp`, `drain`, `sync` and attached or `--embedded` authorities.            |
| `@agent-native/host/embedded`          | server only | `openEmbeddedAuthority`, `workspaceStorage`, `LOCAL_OWNER`, `LOCAL_WORKSPACE`.                                             |
| `@agent-native/host/components`        | server only | The host's own declared requirements (listener, providers), `deploymentCatalog` and `deploymentRequirements`.              |
| `@agent-native/host/providers`         | server only | `createProviderAccess`: provider accounts, API-key funding and harness construction.                                       |
| `@agent-native/host/runtime-manifest`  | server only | Digest checks for the packaged service and its shipped site policy.                                                        |
| `@agent-native/host/optional-packages` | server only | Packages loaded only when an optional adapter is configured; standalone builds keep them external.                         |

`host` and `integrations` are also importable by path; prefer the root export.

Five entries are thin composers over a folder of parts that are imported only from inside the package:

- `src/host/`: `startHost`'s steps (authority, agents, connection files, cleanup stack) and its routes (`routes/` with shutdown, UI sessions and runs), plus the SQLite run store and the agent tool port.
- `src/providers/`: shared `ProviderState`, owner scope and vault namespacing, profile selection, the verified native runtime, lazy harnesses, the provider account routes, the model catalog and the OAuth callback. The default `fetch` is chosen only in `providers.ts`, which is the egress-exempt file; the parts call it through the state.
- `src/plugins/`: plugin composition (`compose`: list check, state slices, slice handlers, authorization routing), the null ports and their resolution (`ports`), settings (`settings`) and the lifecycle (`lifecycle`: open in order, `ready`, `start`, `describe`, close in reverse). `application.ts`, `host/authority.ts` and `embedded.ts` call them.
- `src/cli/`: one module per command group (`serve`, `mcp`, `sync`/`drain`, operations) and shared argument parsing.

## Trust boundary

An application definition is trusted code: its policy, handlers and connections run inside the authority with the host's privileges. Only callers are untrusted. The host derives every `ExecutionContext` from a session, connection file or grant file. Launch credentials are single-use and expire; connection files are written for local clients and are credentials.

One authority per workspace, enforced by the same OS lock for a serving and an embedded host. Embedded authorities never start observers. Observers start only after the host listens, and a failed start stops the ones already running. Plugins are trusted code like the definition. They open before storage, so a plugin that refuses (an unusable policy) stops startup before state is opened. A plugin's `start` runs only in a serving host, after it listens, as the local owner narrowed by a grant. Without a provider the network port refuses every destination, ingress binds 127.0.0.1, identity admits the local owner and there is no audit log. Two providers of one port refuse startup, and so does a supplied setting no plugin declares. Agent runs reach providers only through `ports.network`. `providers.ts` falls back to global `fetch` only when constructed without one, an exemption listed in `scripts/boundary-rules.ts`, and `check:boundaries` fails if `src/` imports `security`, `assurance`, `egress` or `event-log`.

Provider credentials pay for inference and never grant workspace access. Startup and status never read the vault.

Environment the host reads: `WORKSPACE_PATH`, `AGENT_NATIVE_APPLICATION`, `AGENT_NATIVE_CONNECTION`, `AGENT_NATIVE_GRANT_FILE`, `AGENT_RUNTIME_MANIFEST`, plus each composed plugin's declared settings (`readPluginSettings`).

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/adapters`, `@agent-native/client`, `@agent-native/agents`, `@agent-native/integration`, `@agent-native/react` (types only). External: `@modelcontextprotocol/sdk`, `@ai-sdk/openai`. It must never import `apps/*` or `examples/*`; `bun run check:boundaries` fails if it does.

## Tests

```sh
bun test packages/host
bun run test:service
```

`test/plugins.test.ts` covers plugin composition and the kernel ports ([P11](../../docs/principles.md#p11--framework-starter-and-content-are-separate-layers-and-an-authority-runs-one-application), [P13](../../docs/principles.md#p13--the-application-reaches-only-what-it-declares-and-the-site-binds-and-records-what-it-does)): manifest merge and collisions, list order and `requires`, slices kept across upgrades, policy routing, open order, cleanup after a failed open, duplicate ports, null defaults, claimed settings, `ready` in an embedded authority and `start` as a delegated caller. `test/providers.test.ts` covers provider access: no credential reads at startup, single-use OAuth callbacks bound to their session, explicit API-key funding and no leaked provider error text. Host behavior against real operations is tested in content: each example's `test/application.test.ts`, and `examples/project-tasks/test/host.test.ts`, `hardening.test.ts` and `security-conformance.test.ts` ([P3](../../docs/principles.md#p3--authority-comes-from-trusted-context-never-from-input-and-is-enforced-at-commit), [P11](../../docs/principles.md#p11--framework-starter-and-content-are-separate-layers-and-an-authority-runs-one-application), [P13](../../docs/principles.md#p13--the-application-reaches-only-what-it-declares-and-the-site-binds-and-records-what-it-does)).

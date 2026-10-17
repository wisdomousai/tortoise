# @agent-native/host

The generic authority process. It runs exactly one application definition supplied by content and owns everything an application should not rewrite: workspace ownership and storage, launch and sessions, HTTP/SSE, embedded MCP, the application CLI, agent run supervision, provider accounts, background delivery and observers. The host names no domain and no security concept. It is a kernel: what crosses the process boundary goes through ports with deny-by-default defaults, and the application's [plugins](../../docs/primitives.md#host-plugin) provide more, such as `@agent-native/site`, `@agent-native/network` and `@agent-native/audit`.

Layer: framework (`packages/*`). The starter's `apps/service` calls it; content calls only `defineManifest` and `defineApplication`, and plugins only `definePluginManifest` and `defineHostPlugin`.

## Primitives

- [Application](../../docs/primitives.md#application): `defineManifest`, `ApplicationManifest`, `defineApplication`, `ApplicationDefinition`, `ApplicationConnections`.
- [Host](../../docs/primitives.md#host): `startHost`, `serve`, `createCli`, `openEmbeddedAuthority`, `combineIntegrations`, `readStarterConfig`, `loadApplication`, `loadManifest`, `hostComponents`, `deploymentCatalog`, `deploymentRequirements`.
- [Host plugin](../../docs/primitives.md#host-plugin): `definePluginManifest`, `PluginManifest`, `PluginSetting`, `PluginModules`, `defineHostPlugin`, `HostPlugin`, `AnyHostPlugin`, `PluginInstance`, `PluginOpenContext`, `PluginStartContext`, `PluginCommand`, `HostPorts`, `NetworkPort`, `IngressPort`, `IdentityPort`, `defaultPorts`, `readPluginSettings`, `PluginSettings`. The definitions and the ports come from [`@agent-native/kernel`](../kernel/README.md); the host re-exports them and adds the Bun parts.
- [Host platform](../../docs/primitives.md#host-platform): `bunPlatform` (sockets, child processes and loopback ingress; SQLite storage, a file blob store in the workspace's `blobs` directory and the OS workspace lock), `BunNetworkPort`, `bunSocket`, `childEnvironment`.
- [Shell port](../../docs/primitives.md#shell-port): the shell routes (`POST /api/v1/shell/requests`, `POST /api/v1/shell/actions`, `GET /api/v1/shell/actions` and `POST /api/v1/shell/actions/:id/result` for an adapter in another process, `GET /api/v1/shell/declarations`) and the delivery routes (`GET /api/v1/ui/deliveries`, `POST /api/v1/ui/deliveries/:id/ack`).
- [Remote query](../../docs/primitives.md#remote-query): `ApplicationDefinition.sources` binds each remote target to a `RemoteSource`, which the host hands to the runtime. A target without a source answers `unavailable`.
- [Compliance bundle](../../docs/primitives.md#compliance-bundle): `deploymentCatalog` is the composed catalog plus host components the generators read.

Each example's `manifest.ts` and `application.ts` show the two content entrypoints, for example [`examples/project-tasks/application.ts`](../../examples/project-tasks/application.ts). The [architecture](../../docs/architecture.md#layers) explains the layering and the [plugin kernel](../../docs/architecture.md#plugins-and-a-closed-kernel).

## Entrypoints

| Import                                 | Runs in     | Contents                                                                                                                             |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `@agent-native/host`                   | server only | The public API listed under Primitives.                                                                                              |
| `@agent-native/host/*`                 | server only | One source file, listed below. Only `manifest` and `plugin-manifest` are browser-safe.                                               |
| `@agent-native/host/manifest`          | browser     | `defineManifest`: an application's id, title and modules. Imports no host code.                                                      |
| `@agent-native/host/plugin-manifest`   | browser     | `definePluginManifest`, `PluginSetting`: a plugin's id, modules, components and settings. Imports no host code.                      |
| `@agent-native/host/plugin`            | server only | The kernel's `defineHostPlugin`, port types and lifecycle contexts, plus `BunNetworkPort`, `bunSocket` and `childEnvironment`.       |
| `@agent-native/host/application`       | server only | `defineApplication`, `createApplicationRuntime`, `ConnectContext`, `Observer`.                                                       |
| `@agent-native/host/config`            | server only | `app.config.json` reading, the URL scheme, and runtime resolution of the configured application (`loadApplication`, `loadManifest`). |
| `@agent-native/host/serve`             | server only | `serve`: run the HTTP authority until SIGINT/SIGTERM; the first stdout line is a `listening` JSON record.                            |
| `@agent-native/host/cli`               | server only | `createCli`: catalog-derived CLI with `serve`, `mcp`, `drain`, `sync` and attached or `--embedded` authorities.                      |
| `@agent-native/host/platform/bun`      | server only | `bunPlatform` and `workspaceStorage`: the kernel's host platform on Bun.                                                             |
| `@agent-native/host/embedded`          | server only | `openEmbeddedAuthority`, `workspaceStorage`, `LOCAL_OWNER`, `LOCAL_WORKSPACE`.                                                       |
| `@agent-native/host/components`        | server only | The host's own declared requirements (listener, providers), `deploymentCatalog` and `deploymentRequirements`.                        |
| `@agent-native/host/providers`         | server only | `createProviderAccess`: provider accounts, API-key funding and harness construction.                                                 |
| `@agent-native/host/runtime-manifest`  | server only | Digest checks for the packaged service and its shipped site policy.                                                                  |
| `@agent-native/host/optional-packages` | server only | Packages loaded only when an optional adapter is configured; standalone builds keep them external.                                   |

`host` and `integrations` are also importable by path; prefer the root export.

The larger entries are thin composers over folders of parts:

- `src/host/`: `startHost`'s steps (authority, agents, connection files, cleanup stack) and its routes (`routes/` with shutdown, UI sessions and runs), plus the SQLite run store and the agent tool port.
- `src/providers/`: shared `ProviderState`, owner scope and vault namespacing, profile selection, the verified native runtime, lazy harnesses, the provider account routes, the model catalog and the OAuth callback. The default `fetch` is chosen only in `providers.ts`, which is the egress-exempt file; the parts call it through the state.
- `src/plugins/`: the Bun side of the kernel's plugin parts: `loopbackIngress` as the default ingress (`ports`), `readPluginSettings` from the environment (`settings`) and `openPlugins` on `bunPlatform` (`lifecycle`). Composition, port resolution and the lifecycle live in the kernel.
- `src/platform/`: `bunPlatform`, which `embedded.ts` and `host/authority.ts` pass to the kernel's `openAuthority`.
- `src/cli/`: one module per command group (`serve`, `mcp`, `sync`/`drain`, operations) and shared argument parsing.

## Trust boundary

An application definition is trusted code: its policy, handlers and connections run inside the authority with the host's privileges. Only callers are untrusted. The host derives every `ExecutionContext` from a session, connection file or grant file. Launch credentials are single-use and expire; connection files are written for local clients and are credentials.

One authority per workspace, enforced by the same OS lock for a serving and an embedded host. Embedded authorities never start observers. Observers start only after the host listens, and a failed start stops the ones already running. Plugins are trusted code like the definition. They open before storage, so a plugin that refuses (an unusable policy) stops startup before state is opened. A plugin's `start` runs only in a serving host, after it listens, as the local owner narrowed by a grant. Without a provider the network port refuses every destination, ingress binds 127.0.0.1, identity admits the local owner and there is no audit log. Two providers of one port refuse startup, and so does a supplied setting no plugin declares. Agent runs reach providers only through `ports.network`. `providers.ts` falls back to global `fetch` only when constructed without one, an exemption listed in `scripts/boundary-rules.ts`, and `check:boundaries` fails if `src/` imports `security`, `assurance`, `egress` or `event-log`.

The shell routes answer `UNAVAILABLE` unless a plugin provides the shell port. A request an adapter submits is delivered only to the submitting session's frame, after the delivery store authorizes it; the response says only whether it was delivered, consumed or refused. An adapter in another process attaches by long-polling `GET /api/v1/shell/actions` with its own bearer; only that session can answer the instructions it took, an unanswered instruction counts as not performed after 30 seconds, and a relay that stops polling for a minute or whose session is revoked is detached. The embedded authority (one-shot CLI, embedded MCP) has no shell routes and attaches no adapter.

Provider credentials pay for inference and never grant workspace access. Startup and status never read the vault.

Environment the host reads: `WORKSPACE_PATH`, `AGENT_NATIVE_APPLICATION`, `AGENT_NATIVE_CONNECTION`, `AGENT_NATIVE_GRANT_FILE`, `AGENT_RUNTIME_MANIFEST`, plus each composed plugin's declared settings (`readPluginSettings`).

## Dependencies

Framework: `@agent-native/kernel`, `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/adapters`, `@agent-native/client`, `@agent-native/agents`, `@agent-native/integration`, `@agent-native/react` (types only). External: `@modelcontextprotocol/sdk`, `@ai-sdk/openai`. It must never import `apps/*` or `examples/*`; `bun run check:boundaries` fails if it does.

## Tests

```sh
bun test packages/host
bun run test:service
```

The shell and delivery routes are tested with a fixture application in `plugins/os/test/os.test.ts`. `test/config.test.ts` covers the URL scheme: its default from the application ID and the refusal of reserved or malformed schemes. `test/plugins.test.ts` covers plugin composition and the kernel ports: manifest merge and collisions, list order and `requires`, slices kept across upgrades, policy routing, open order, cleanup after a failed open, duplicate ports, null defaults, claimed settings, `ready` in an embedded authority and `start` as a delegated caller. `test/providers.test.ts` covers provider access: no credential reads at startup, single-use OAuth callbacks bound to their session, explicit API-key funding and no leaked provider error text. Host behavior against real operations is tested in content: each example's `test/application.test.ts`, and `examples/project-tasks/test/host.test.ts`, `hardening.test.ts` and `security-conformance.test.ts`.

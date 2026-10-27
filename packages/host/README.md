# @agent-native/host

The Bun [host](../../docs/glossary.md#host): the generic process that opens an [instance](../../docs/glossary.md#instance) for exactly one [application definition](../../docs/glossary.md#application-definition) supplied by content. It owns what an application should not rewrite: workspace ownership and storage, launch and sessions, HTTP and SSE, embedded MCP, the application CLI, agent run supervision, provider accounts, background delivery and observers. The host names no domain and no security concept. What crosses the process boundary goes through [composition](../../docs/glossary.md#composition) ports that deny by default, and the application's [host plugins](../../docs/glossary.md#host-plugin) provide more, such as `@agent-native/site`, `@agent-native/network` and `@agent-native/audit`.

## Layer

Framework (`packages/*`). The starter's `apps/service` calls it. Content calls only `defineManifest` and `defineApplication`, and plugins only `definePluginManifest` and `defineHostPlugin`. The host trusts the application definition and its plugins, and treats every caller as untrusted.

## Primitives

- [Application](../../docs/primitives.md#application): `defineManifest`, `ApplicationManifest`, `defineApplication`, `ApplicationDefinition`, `ApplicationConnections`.
- [Host](../../docs/primitives.md#host): `startHost`, `serve`, `createCli`, `openEmbeddedInstance`, `combineIntegrations`, `readStarterConfig`, `readMobileTarget`, `loadApplication`, `loadManifest`, `hostComponents`, `deploymentCatalog`, `deploymentRequirements`.
- [Feature](../../docs/primitives.md#feature): `defineFeature`, `mountFeature`, `Feature`, `FeatureMount`, `FeatureAdoption` and `MountBindings`, re-exported from [`@agent-native/kernel`](../kernel/README.md) at `@agent-native/host/feature`.
- [Host plugin](../../docs/primitives.md#host-plugin): `definePluginManifest`, `PluginManifest`, `PluginSetting`, `PluginModules`, `defineHostPlugin`, `HostPlugin`, `AnyHostPlugin`, `PluginInstance`, `PluginOpenContext`, `PluginStartContext`, `PluginCommand`, `HostPorts`, `NetworkPort`, `IngressPort`, `IdentityPort`, `defaultPorts`, `readPluginSettings`, `PluginSettings`. The definitions and the ports come from [`@agent-native/kernel`](../kernel/README.md); the host re-exports them and adds the Bun parts.
- [Host platform](../../docs/primitives.md#host-platform): `bunPlatform` and the Bun port types, described under [Bun platform](#bun-platform).
- [Host platform](../../docs/primitives.md#host-platform): `hostedPlatform` (`HostedPlatformOptions`), the Bun platform with the workspace in Postgres under a [workspace lease](../../docs/glossary.md#workspace-lease). `serve --hosted-workspace <name>` selects it, with `AGENT_NATIVE_DATABASE_URL`.
- [Shell port](../../docs/primitives.md#shell-port): the shell routes and the delivery routes, listed under [Shell and delivery routes](#shell-and-delivery-routes).
- [State migration](../../docs/primitives.md#state-migration): `migrate [--dry-run]`, described under [Migrate command](#migrate-command).
- [Shelf life](../../docs/primitives.md#shelf-life): a definition stamped by its build entry gives `startHost` its build facts. They are in the `listening` record, in each plugin's open context, and at `GET /api/v1/build` for a signed-in session. A run from source returns `{}`.
- [Remote query](../../docs/primitives.md#remote-query): `ApplicationDefinition.sources` binds each remote target to a `RemoteSource`, which the host hands to the runtime. A target without a source returns `unavailable`.
- [UI session context](../../docs/primitives.md#ui-session-context): a run started from a UI session gets the `ui.open`, `ui.select` and `ui.request-review` tools, which send intents to that session through `UiSessionStore.sendFromRun`. The host checks each named resource under the run's grant and against `selectableResources`.
- [Compliance bundle](../../docs/primitives.md#compliance-bundle): `deploymentCatalog` is the composed catalog plus the host components that the generators read.

Each example's `manifest.ts` and `application.ts` show the two content entrypoints, for example [`examples/field-service/application.ts`](../../examples/field-service/application.ts).

### Bun platform

`bunPlatform` offers sockets, child processes and loopback ingress. It stores the workspace in SQLite row storage that keeps `JOURNAL_RETENTION` journal entries. Blobs go to a file blob store in the workspace's `blobs` directory, and ownership is the OS workspace lock.

`BunNetworkPort`, `bunSocket` and `childEnvironment` give plugins the Bun-typed network port. `BunProcessPort`, `bunProcesses`, `SpawnedProcess` and `SpawnedChild` type the process port's handle on Bun as the child's streams and a `terminate` for its tree. `ServingPlatform` and `ServingOwnership` type the platform that `startHost` takes as `platform`.

### Shell and delivery routes

- `POST /api/v1/shell/requests` and `GET /api/v1/shell/declarations`;
- `POST /api/v1/shell/actions`;
- `GET /api/v1/shell/actions` and `POST /api/v1/shell/actions/:id/result`, for an adapter in another process;
- `GET /api/v1/ui/deliveries` and `POST /api/v1/ui/deliveries/:id/ack`.

### Migrate command

`migrate [--dry-run]` takes the workspace lock and copies the database. It migrates the copy, then checks it: integrity, every stamp at this version, and every workspace loads. Only then does it replace the database, keeping the previous one as `workspace.sqlite.before-migrate`.

That copy is for disaster recovery only. Restoring it would drop records committed since, so a rollback runs older code on the migrated state instead. A host that is not stopped for `migrate` still migrates each workspace in memory as it loads. It persists the result on the next commit, without the check.

## Entrypoints

| Import                                 | Runs in     | Contents                                                                                                                                                         |
| -------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/host`                   | server only | Application, manifest and plugin definitions, ports, `openEmbeddedInstance`, `startHost`, `serve`, `createCli`, `combineIntegrations` and the config readers.   |
| `@agent-native/host/*`                 | server only | One source file from `src/`. Only `manifest` and `plugin-manifest` are browser-safe.                                                                           |
| `@agent-native/host/manifest`          | browser     | `defineManifest`: an application's ID, title and modules. Imports no host code.                                                                                  |
| `@agent-native/host/plugin-manifest`   | browser     | `definePluginManifest`, `PluginSetting`: a plugin's ID, modules, components and settings. Imports no host code.                                                  |
| `@agent-native/host/plugin`            | server only | The composition's `defineHostPlugin`, port types and lifecycle contexts, plus `BunNetworkPort`, `bunSocket`, `childEnvironment`, `BunProcessPort` and `bunProcesses`. |
| `@agent-native/host/enrollment`        | server only | Pairing by a one-use code: `newEnrollmentCode`, `normalizeCode`, `newCredential`, `credentialPattern`, `credentialDigest` and `createAttemptLimit`, shared by the device link and the peer link. |
| `@agent-native/host/application`       | server only | `defineApplication`, `createApplicationRuntime`, `ConnectContext`, `Observer`.                                                                                   |
| `@agent-native/host/config`            | server only | `app.config.json` reading, the URL scheme, and runtime resolution of the configured application (`loadApplication`, `loadManifest`).                             |
| `@agent-native/host/mobile-target`     | build time  | `readMobileTarget`: the application the mobile starter hosts, from `targets.mobile` in `app.config.json`.                                                            |
| `@agent-native/host/serve`             | server only | `serve`: run the HTTP instance until SIGINT or SIGTERM. The first stdout line is a `listening` JSON record.                                                     |
| `@agent-native/host/cli`               | server only | `createCli`: catalog-derived CLI with `serve`, `mcp`, `drain`, `sync`, `backup`, `restore`, `migrate` and attached or `--embedded` instances.                  |
| `@agent-native/host/platform/bun`      | server only | `bunPlatform` and `workspaceStorage`: the composition's host platform on Bun.                                                                                         |
| `@agent-native/host/platform/hosted`   | server only | `hostedPlatform`: the Bun platform with Postgres storage and a workspace lease, for an instance another instance can take over.                                 |
| `@agent-native/host/embedded`          | server only | `openEmbeddedInstance`, `workspaceStorage`, `LOCAL_OWNER`, `LOCAL_WORKSPACE`.                                                                                   |
| `@agent-native/host/components`        | server only | The host's own declared requirements (listener, providers), `deploymentCatalog` and `deploymentRequirements`.                                                    |
| `@agent-native/host/providers`         | server only | `createProviderAccess`: provider accounts, API-key funding and harness construction.                                                                             |
| `@agent-native/host/runtime-manifest`  | server only | Digest checks for the packaged host executable, its shipped deployment policy and the bundled agent runtimes.                                                          |
| `@agent-native/host/optional-packages` | server only | Packages loaded only when an optional adapter is configured; standalone builds keep them external.                                                               |

`host` and `integrations` are also importable by path; prefer the root export.

## Trust boundary

### Callers and sessions

An application definition is trusted code: its policy, handlers and connections run inside the instance with the host's privileges. Only callers are untrusted. The host derives every `ExecutionContext` from a [session](../../docs/glossary.md#session), a [connection file](../../docs/glossary.md#connection-file) or a [grant file](../../docs/glossary.md#grant-file). Launch credentials are single-use and expire. Connection files are written for local clients and are credentials.

### Workspace ownership

One instance owns a workspace. A serving and an embedded host enforce this with the same OS lock. A hosted instance also holds the workspace's lease in Postgres, and the CLI's `serve` exits with code 1 once a renewal finds the lease gone.

### Plugins and observers

Embedded instances never start observers. Observers start only after the host listens, and a failed start stops the ones already running.

Plugins are trusted code like the definition. They open before storage, so a plugin that refuses, for example over an unusable policy, stops startup before state is opened. A plugin's `start` runs only in a serving host, after it listens, as the local owner narrowed by a grant.

Without a provider, each port keeps its default:

- the network port refuses every destination;
- ingress binds 127.0.0.1;
- identity admits the local owner;
- there is no audit log.

Two providers of one port refuse startup, and so does a supplied setting no plugin declares.

### Plugin routes

Public routes are tried in order: agent provider callbacks, then the composed plugins' `publicRoute`. The host offers a bearer token that is not a host session to the plugins' `authenticate`, and such a session cookie to their `authenticateCookie`. An authenticated `/api/` request that none of the host's routes handle goes to the plugins' `route`. The context a plugin returns passes the same policy and grant checks as a session.

### Provider access

Agent runs reach providers only through `ports.network`. `providers.ts` falls back to global `fetch` only when constructed without one, an exemption listed in `scripts/boundary-rules.ts`. `check:boundaries` fails if `src/` imports `@agent-native/event-log`.

Startup and status never read the vault.

### Shell routes

The shell routes return `UNAVAILABLE` unless a plugin provides the [shell port](../../docs/glossary.md#shell-port). A request an adapter submits is delivered only to the submitting session's frame, after the delivery store authorizes it. The response says only whether it was delivered, consumed or refused.

An adapter in another process attaches by long-polling `GET /api/v1/shell/actions` with its own bearer token. Only that session can post results for the instructions it took. An instruction without a posted result counts as not performed after 30 seconds. A relay that stops polling for a minute, or whose session is revoked, is detached. The embedded instance (one-shot CLI, embedded MCP) has no shell routes and attaches no adapter.

### Cross-site requests

Every cross-site request is refused except two public routes: the provider OAuth callback, and the launch page for OS links (`serveOsLaunchPage`). The launch page serves only `index.html`, for a top-level document navigation to `/` with exactly one `os` or `os-shortcut` parameter. A top-level document navigation carries `Sec-Fetch-Mode: navigate` and `Sec-Fetch-Dest: document`. The launch page is exempt from the cross-site refusal because a protocol handler navigates there from whichever site held the link. The page then submits the link same-origin as its own session.

### Environment

The host reads these variables, plus each composed plugin's declared settings (`readPluginSettings`):

- `WORKSPACE_PATH`;
- `AGENT_NATIVE_DATABASE_URL`, with `--hosted-workspace` only;
- `AGENT_NATIVE_APPLICATION`;
- `AGENT_NATIVE_CONNECTION`;
- `AGENT_NATIVE_GRANT_FILE`;
- `AGENT_RUNTIME_MANIFEST`.

## Dependencies

Framework: `@agent-native/kernel`, `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/adapters`, `@agent-native/client`, `@agent-native/agents`, `@agent-native/react` (types only). External: `@modelcontextprotocol/sdk`, `@ai-sdk/openai`. The host must never import `apps/*` or `examples/*`; `bun run check:boundaries` fails if it does.

## Tests

```sh
bun test packages/host
bun run test:service
```

- `test/hosted-platform.test.ts`: two hosted instances on one PGlite database. One serves and the other is refused, a renewal keeps the lease past its first expiry, and after a close the next instance starts from the committed state.
- `test/config.test.ts`: the URL scheme, its default from the application ID, and the refusal of reserved or malformed schemes.
- `test/plugins.test.ts`: plugin composition and the host ports.
  - manifest merge and collisions, list order and `requires`;
  - slices kept across upgrades, policy routing, open order and cleanup after a failed open;
  - duplicate ports, null defaults and claimed settings;
  - `ready` in an embedded instance and `start` as a delegated caller.
- `test/features.test.ts`: feature composition.
  - manifest merge order and refusals for shared ids and namespaces, `requires` and operations outside a namespace;
  - the slice, access view, hooks and policy in one transaction, and refusals for shadowed application rules, service and state keys;
  - a plugin resource type that shadows an application event rule;
  - connections and sources merged and bound once;
  - `feature:<id>` stamps, adoption of legacy data once, and older code refused.
- `test/build.test.ts`: `GET /api/v1/build` for a stamped build past its best-before date, for a run from source, and without a session.
- `test/workspace-backup.test.ts`: backs up a live workspace through the CLI, and refuses to restore while a host owns it.
- `test/migrations.test.ts`: runs `migrate` with a pending effect, after a failed step and over a compatible step, and checks that storage refuses older code.
- `test/providers.test.ts`: no credential reads at startup, single-use OAuth callbacks bound to their session, explicit API-key funding and no leaked provider error text.

The shell and delivery routes are tested with a fixture application in `plugins/os/test/os.test.ts`. Host behavior against real capabilities is tested in content: each example's `test/application.test.ts`, and `examples/field-service/test/host.test.ts`, `hardening.test.ts` and `security-conformance.test.ts`.

## Skills

- [write-a-feature](skills/write-a-feature/SKILL.md): a reusable domain part with its slice, policy over an access view, hooks and adoption.
- [write-host-plugin](skills/write-host-plugin/SKILL.md): a host plugin with its own state, policy, settings and ports.
- [run-a-hosted-instance](skills/run-a-hosted-instance/SKILL.md): a workspace in Postgres under a lease, behind TLS ingress and workforce sign-in.
- [create-agent-native-app](../scaffold/skills/create-agent-native-app/SKILL.md): creating an application with the scaffold.

## References

- [Hosting](../../docs/hosting.md#hosted-instance)
- [Architecture](../../docs/architecture.md#layers)
- [Host plugins](../../docs/architecture.md#host-plugins)
- [Hosting](../../docs/hosting.md#workspace-lease-and-fence)

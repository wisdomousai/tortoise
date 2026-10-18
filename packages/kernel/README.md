# @agent-native/kernel

The [kernel](../../docs/glossary.md#kernel): the portable part of the host. It composes an [application definition](../../docs/glossary.md#application-definition) and its plugins, resolves the kernel's ports and opens one workspace's [authority](../../docs/glossary.md#authority) on a `HostPlatform`. It uses no Node, Bun or React Native API, so the Bun host in [`@agent-native/host`](../host/README.md) and the mobile host share it. Everything that needs the machine comes from the platform the starter passes in: workspace ownership, storage, a listener, sockets and child processes.

## Layer

Framework (`packages/*`). `@agent-native/host` re-exports the definition helpers under its own subpaths, so content and plugins keep importing from the host. The subpaths are `@agent-native/host/manifest`, `/plugin-manifest`, `/plugin`, `/application` and `/integrations`.

## Primitives

- [Application](../../docs/primitives.md#application): `defineManifest`, `ApplicationManifest`, `ApplicationTarget`, `targetPlatforms`, `defineApplication`, `ApplicationDefinition`, `AnyApplicationDefinition`, `ApplicationConnections`, `ConnectContext`, `HostedApplication`, `Observer`, `createApplicationRuntime`, `hostContext`.
- [Host](../../docs/primitives.md#host): `openAuthority`, `OpenAuthorityOptions`, `Authority`, `LOCAL_WORKSPACE`, `LOCAL_OWNER`, `combineIntegrations`, `Integrations`, `deploymentCatalog`, `deploymentComponents`, `deploymentRequirements`.
- [Host plugin](../../docs/primitives.md#host-plugin): `definePluginManifest`, `PluginManifest`, `PluginModules`, `PluginSetting`, `defineHostPlugin`, `HostPlugin`, `AnyHostPlugin`, `PluginInstance`, `CredentialSource`, `PluginOpenContext`, `PluginStartContext`, `SettingsProviderContext`, `PluginCommand`, `HostPorts`, `NetworkPort`, `IngressPort`, `IdentityPort`, `defaultPorts`, `noIngress`, `resolvePorts`, `isolatedNetwork`, `latePorts`, `openPlugins`, `OpenedPlugins`, `PluginPlatform`, `PluginSettings`, `assertClaimed`, `settingsFor`, `mergeSettings`.
- [Shell port](../../docs/primitives.md#shell-port): `ShellPort`, `ShellAdapter`, `noShell` (the default, which refuses every call), `HostPorts.shell`, and `HostPlatform.shell`, the adapter a platform that runs the OS in-process supplies.
- [Process port](../../docs/primitives.md#process-port): `ProcessPort`, `ProcessAvailability`, `ProcessSpawnOptions`, `noProcesses`, `HostPorts.processes` and `ConnectContext.processes`. The default `noProcesses` reports every process unavailable and rejects every start.
- [Exchange folder](../../docs/glossary.md#exchange-folder): `FolderPort`, `BoundFolder`, `noFolders` and `HostPorts.folders`. Under the default `noFolders`, every folder is unavailable until a plugin binds folders.
- [State migration](../../docs/primitives.md#state-migration): `StateMigrations`, `MigrationStep`, `checkMigrations`, `currentVersion`, `migrateSlice`, `stateUpgrade`, `ApplicationDefinition.migrations` and `HostPlugin.state.migrations`. Details under [State migrations](#state-migrations).
- [Blob store](../../docs/primitives.md#blob-store): `HostPlatform.openBlobs` gives each authority its workspace's store. A serving authority sweeps unreferenced blobs when it opens.
- [Host platform](../../docs/primitives.md#host-platform): `HostPlatform`, `PlatformId`, `platformIds`, `PlatformCapability`, `PlatformOwnership`, `assertPlatformSupports`, `installGlobals`, `assertGlobals`, `missingGlobals`, `RequiredGlobal`, `SecretStore`, `scopedSecrets`.

The kernel never starts a process. A plugin such as `@agent-native/process` provides the process port, and `spawn` returns the platform's handle as `unknown`.

### State migrations

`stateUpgrade` turns a composed definition into the storage upgrade that both platforms pass to their storage. Each slice is stamped with the version it holds and the oldest version that reads it. The application's steps never see a plugin slice, and each plugin's steps see only its own. The unversioned `upgradeState` still runs after them on every load. `ApplicationDefinition.contractVersion` is recorded on every effect the application enqueues.

## Entrypoints

| Import                                 | Runs in  | Contents                                                                                                                                                                                                         |
| -------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/kernel`                 | any host | The public API listed under Primitives.                                                                                                                                                                          |
| `@agent-native/kernel/*`               | any host | One source file, listed below. Only `manifest` and `plugin-manifest` are browser-safe.                                                                                                                           |
| `@agent-native/kernel/manifest`        | browser  | `defineManifest` and the application's `targets` (`desktop`, `web`, `mobile`), checked against each plugin's `platforms`. `expoPlugins` lists the Expo config plugins of the application's own native libraries, for mobile targets only. |
| `@agent-native/kernel/plugin-manifest` | browser  | `definePluginManifest`, `PluginSetting`, `PluginNative`, `platformIds`. Without `platforms`, a plugin runs only on `bun`. `native` names an Expo module and config plugin and requires `android` or `ios`. |
| `@agent-native/kernel/plugin`          | any host | `defineHostPlugin`, the port types and the lifecycle contexts. `NetworkPort.socket` and `childEnvironment` are optional here.                                                                                    |
| `@agent-native/kernel/application`     | any host | `defineApplication`, `createApplicationRuntime`, `ConnectContext`, `Observer`.                                                                                                                                   |
| `@agent-native/kernel/integrations`    | any host | `combineIntegrations`: one delivery and sync loop over the application's connections.                                                                                                                            |
| `@agent-native/kernel/components`      | any host | `deploymentComponents`, `deploymentCatalog`, `deploymentRequirements`, each taking the platform's own components.                                                                                                |
| `@agent-native/kernel/platform`        | any host | `HostPlatform`, `PlatformOwnership`, `PlatformCapability`, `assertPlatformSupports`, `SecretStore`, `scopedSecrets`.                                                                                             |
| `@agent-native/kernel/authority`       | any host | `openAuthority`, `LOCAL_WORKSPACE`, `LOCAL_OWNER`.                                                                                                                                                               |
| `@agent-native/kernel/globals`         | any host | `installGlobals`, `assertGlobals`, `missingGlobals`.                                                                                                                                                             |
| `@agent-native/kernel/migrations`      | any host | `StateMigrations`, `MigrationStep`, `checkMigrations`, `currentVersion`, `migrateSlice`.                                                                                                                         |
| `@agent-native/kernel/state-upgrade`   | any host | `stateUpgrade`: the storage upgrade for a composed definition.                                                                                                                                                   |

`plugins/compose`, `plugins/ports`, `plugins/settings` and `plugins/lifecycle` are importable by path for the host's wrappers; prefer the root export.

The Bun host adds what needs Bun: `loopbackIngress`, `readPluginSettings`, the Bun-typed `socket` and `childEnvironment`, and `bunPlatform` in `packages/host/src/platform/bun.ts`. `openEmbeddedAuthority` and `startHost` both call `openAuthority` with that platform.

## Trust boundary

### Startup refusals

A platform is trusted host code chosen by the starter; content never supplies one. Application definitions and plugins are trusted as in the host. The kernel refuses these before the workspace is opened:

- A plugin whose `platforms` does not list the running platform refuses startup. So does a manifest that lists a plugin under a `targets` entry the plugin cannot run on.
- A deployment that declares a socket destination, an ingress destination or a child process on a platform without `sockets`, `ingress` or `child-process` refuses startup. The refusal names the component that declared it.
- A JavaScript host missing a required global refuses before plugins open. The required globals are `structuredClone`, `AbortController`, `AbortSignal.any`, `AbortSignal.timeout`, `crypto.getRandomValues` and `crypto.randomUUID`.

`installGlobals` fills the gaps it can implement in JavaScript. A secure `getRandomValues` must come from the platform, so a host without one still fails.

When the workspace loads, storage refuses a workspace whose state was migrated past this code's version, unless every step since this version was declared `compatible`. Such state is neither read nor overwritten. A migration chain with a gap, or one that ends anywhere but `version`, fails in `defineApplication`.

### Settings providers

`provideSettings` lets a plugin, such as a managed-configuration reader, supply settings for other plugins before any of them opens. Provided settings override launcher settings unless the caller sets `launcherSettingsWin`, which is meant for development builds. Two providers of one key refuse startup, and so do non-string values. A plugin must still claim each key of the merged result.

### Shell port

The kernel has no OS integration of its own: the default [shell port](../../docs/glossary.md#shell-port) refuses every request, action and attachment with `UNAVAILABLE`. A provider receives OS requests as the session that submitted them. That session only says where to deliver; nothing in a request sets the principal, workspace or grant.

### Plugin routes and credentials

On a serving host a plugin instance may implement these hooks:

- `publicRoute(request)`, answered before the session check;
- `authenticate(token)`, which resolves a bearer credential the plugin issued to an `ExecutionContext`;
- `authenticateCookie(token)`, which does the same for an `agent_session` cookie the plugin set for a signed-in person;
- `route(request, context)`, which receives an `/api/` request that the host has authenticated and not routed, with the caller's context.

Use `route` for work that must happen before any command runs, such as hashing a PIN so it never becomes a stored command input. The two credential hooks never see each other's tokens. `authenticate(token, via)` on the opened plugins routes by `CredentialSource`. A device's bearer credential therefore cannot be replayed from a cookie, which any web page in the browser can have sent.

The opened plugins try each hook in composition order and use the first answer. The host consults them only after its own routes and sessions. A plugin that answers a public route handles untrusted input before any authentication.

### Secrets

`PluginOpenContext.secrets` is the platform's `SecretStore` wrapped by `scopedSecrets`. Names are limited to letters, digits, `.`, `_` and `-`. Each name is stored under the workspace and plugin ID, so a plugin reads only its own entries. The field is absent on a platform without a secret store.

### Listener and ownership

The kernel binds no listener of its own. The default ingress is the platform's, and without one every `listen` fails with `UNAVAILABLE`. `openAuthority` does not acquire or release ownership. The caller acquires it from the same platform and releases it after `close`. On a failed open the kernel closes what it opened and leaves the ownership with the caller.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/integration`. External: `@ungap/structured-clone`, the `structuredClone` fallback.

`check:boundaries` applies the host's forbidden imports to `src/`, and the portable-source rule: no `node:` or `bun:` import, no Bun-only package and no `Bun`, `process`, `Buffer` or `require` global.

## Tests

```sh
bun test packages/kernel
bun run test:portable
```

- `test/kernel.test.ts` opens authorities on the in-memory platform in `test/fake-platform.ts`, which uses no Node or Bun API.
  - state persisted across reopen, and a plugin refused on the wrong platform;
  - capability refusals for sockets, child processes and ingress;
  - settings providers: precedence, `launcherSettingsWin`, unclaimed keys and duplicate providers;
  - cleanup after a failed `ready`, and the closed default ingress;
  - manifest validation of `targets`, `platforms` and `expoPlugins`.
- `test/shell.test.ts`: the default shell port's refusals, and a single provider composed through `resolvePorts` and the late view.
- `test/processes.test.ts`: without a provider no process starts and availability says why; one plugin may provide the port, the late view reads it, and two providers are refused.
- `test/globals.test.ts`: the required globals behave as the runtime expects.

`bun run test:portable` runs the kernel, runtime, client, integration and mobile suites with `test/without-web-globals.ts` preloaded. That file deletes the globals Hermes may lack and installs the kernel's replacements, so those suites prove they run without Bun's versions.

## Skills

- [write-host-plugin](../host/skills/write-host-plugin/SKILL.md): a host plugin with its own state, policy, settings and ports.
- [add-capability](../runtime/skills/add-capability/SKILL.md): commands, queries, policy, record shapes and triggers.

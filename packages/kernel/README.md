# @agent-native/kernel

The portable part of the host. It composes an application definition and its plugins, resolves the kernel's ports and opens one workspace's authority on a `HostPlatform`. It uses no Node, Bun or React Native API, so the Bun host in [`@agent-native/host`](../host/README.md) and the mobile host share it. Everything that needs the machine (workspace ownership, storage, a listener, sockets, child processes) comes from the platform the starter passes in.

Layer: framework (`packages/*`). `@agent-native/host` re-exports the definition helpers under its own subpaths (`@agent-native/host/manifest`, `/plugin-manifest`, `/plugin`, `/application`, `/integrations`), so content and plugins keep importing from the host.

## Primitives

- [Application](../../docs/primitives.md#application): `defineManifest`, `ApplicationManifest`, `ApplicationTarget`, `targetPlatforms`, `defineApplication`, `ApplicationDefinition`, `AnyApplicationDefinition`, `ApplicationConnections`, `ConnectContext`, `HostedApplication`, `Observer`, `createApplicationRuntime`, `hostContext`.
- [Host](../../docs/primitives.md#host): `openAuthority`, `OpenAuthorityOptions`, `Authority`, `LOCAL_WORKSPACE`, `LOCAL_OWNER`, `combineIntegrations`, `Integrations`, `deploymentCatalog`, `deploymentComponents`, `deploymentRequirements`.
- [Host plugin](../../docs/primitives.md#host-plugin): `definePluginManifest`, `PluginManifest`, `PluginModules`, `PluginSetting`, `defineHostPlugin`, `HostPlugin`, `AnyHostPlugin`, `PluginInstance`, `PluginOpenContext`, `PluginStartContext`, `SettingsProviderContext`, `PluginCommand`, `HostPorts`, `NetworkPort`, `IngressPort`, `IdentityPort`, `defaultPorts`, `noIngress`, `resolvePorts`, `isolatedNetwork`, `latePorts`, `openPlugins`, `OpenedPlugins`, `PluginPlatform`, `PluginSettings`, `assertClaimed`, `settingsFor`, `mergeSettings`.
- [Host platform](../../docs/primitives.md#host-platform): `HostPlatform`, `PlatformId`, `platformIds`, `PlatformCapability`, `PlatformOwnership`, `assertPlatformSupports`, `installGlobals`, `assertGlobals`, `missingGlobals`, `RequiredGlobal`.

## Entrypoints

| Import                                 | Runs in  | Contents                                                                                                                      |
| -------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/kernel`                 | any host | The public API listed under Primitives.                                                                                       |
| `@agent-native/kernel/*`               | any host | One source file, listed below. Only `manifest` and `plugin-manifest` are browser-safe.                                        |
| `@agent-native/kernel/manifest`        | browser  | `defineManifest` and the application's `targets` (`desktop`, `web`, `mobile`), checked against each plugin's `platforms`.     |
| `@agent-native/kernel/plugin-manifest` | browser  | `definePluginManifest`, `PluginSetting`, `platformIds`. `platforms` absent means the plugin runs only on `bun`.               |
| `@agent-native/kernel/plugin`          | any host | `defineHostPlugin`, the port types and the lifecycle contexts. `NetworkPort.socket` and `childEnvironment` are optional here. |
| `@agent-native/kernel/application`     | any host | `defineApplication`, `createApplicationRuntime`, `ConnectContext`, `Observer`.                                                |
| `@agent-native/kernel/integrations`    | any host | `combineIntegrations`: one delivery and sync loop over the application's connections.                                         |
| `@agent-native/kernel/components`      | any host | `deploymentComponents`, `deploymentCatalog`, `deploymentRequirements`, each taking the platform's own components.             |
| `@agent-native/kernel/platform`        | any host | `HostPlatform`, `PlatformOwnership`, `PlatformCapability`, `assertPlatformSupports`.                                          |
| `@agent-native/kernel/authority`       | any host | `openAuthority`, `LOCAL_WORKSPACE`, `LOCAL_OWNER`.                                                                            |
| `@agent-native/kernel/globals`         | any host | `installGlobals`, `assertGlobals`, `missingGlobals`.                                                                          |

`plugins/compose`, `plugins/ports`, `plugins/settings` and `plugins/lifecycle` are importable by path for the host's wrappers; prefer the root export.

The Bun host adds what needs Bun: `loopbackIngress`, `readPluginSettings`, the Bun-typed `socket` and `childEnvironment`, and `bunPlatform` in `packages/host/src/platform/bun.ts`. `openEmbeddedAuthority` and `startHost` both call `openAuthority` with that platform.

## Trust boundary

A platform is trusted host code chosen by the starter; content never supplies one. Application definitions and plugins are trusted as in the host. The kernel adds three refusals, all before the workspace is opened:

- A plugin whose `platforms` does not list the running platform refuses startup, and so does a manifest that lists a plugin under a `targets` entry the plugin cannot run on.
- A deployment that declares a socket destination, an ingress destination or a child process on a platform without `sockets`, `ingress` or `child-process` refuses startup, naming the component that declared it.
- A JavaScript host missing a required global (`structuredClone`, `AbortController`, `AbortSignal.any`, `AbortSignal.timeout`, `crypto.getRandomValues`, `crypto.randomUUID`) refuses before plugins open. `installGlobals` fills the gaps it can implement in JavaScript; a secure `getRandomValues` must come from the platform, so a host without one still fails.

`provideSettings` lets a plugin (such as a managed-configuration reader) supply settings for other plugins before any of them opens. Provided settings override launcher settings unless the caller sets `launcherSettingsWin`, which is meant for development builds. Two providers of one key and non-string values refuse startup, and the merged result must still be claimed by a plugin.

The kernel binds no listener of its own: the default ingress is the platform's, and without one every `listen` fails with `UNAVAILABLE`. `openAuthority` does not acquire or release ownership. The caller acquires it from the same platform and releases it after `close`; on a failed open the kernel closes what it opened and leaves the ownership with the caller.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/integration`. External: `@ungap/structured-clone` (the `structuredClone` fallback). `check:boundaries` applies the host's forbidden imports to `src/` and the portable-source rule: no `node:` or `bun:` import, no Bun-only package and no `Bun`, `process`, `Buffer` or `require` global.

## Tests

```sh
bun test packages/kernel
bun run test:portable
```

`test/kernel.test.ts` opens authorities on the in-memory platform in `test/fake-platform.ts`, which uses no Node or Bun API. It covers state persisted across reopen, a plugin refused on the wrong platform, capability refusals for sockets, child processes and ingress, settings providers (precedence, `launcherSettingsWin`, unclaimed keys, duplicate providers), cleanup after a failed `ready`, the closed default ingress, and manifest validation of `targets` and `platforms`. `test/globals.test.ts` checks that the required globals behave as the runtime expects. `bun run test:portable` runs the kernel, runtime, client and integration suites with `test/without-web-globals.ts` preloaded: it deletes the globals Hermes may lack and installs the kernel's replacements, so those suites prove they run without Bun's versions.

---
name: write-host-plugin
description: Write a host plugin in plugins/<name> for a cross-cutting concern (deployment policy, network, audit, compliance, notifications, a third-party integration) that several applications compose. Use when behavior is not one application's domain but needs its own state slice, policy, settings, lifecycle hooks, CLI verbs, screens or a host port. plugins/webhook is the template.
---

# Write a host plugin

A [host plugin](../../../../docs/glossary.md#host-plugin) adds [modules](../../../../docs/glossary.md#module), a state slice, a [policy](../../../../docs/glossary.md#policy), settings, lifecycle hooks and ports to the [host](../../../../docs/glossary.md#host). An [application](../../../../docs/glossary.md#application) lists it in its three entrypoints, so generated artifacts follow from the application alone. `plugins/webhook` is written the way a third party would write one.

## Before writing

- Decide whether the concern is a plugin. Domain behavior for one application is a [capability](../../../../docs/glossary.md#capability) in that application; follow the `add-capability` skill (`packages/runtime/skills/add-capability/SKILL.md`).
- Put generic host or frame behavior that every application needs in the framework packages.
- `samples/notes-host-plugin/plugins/activity` is a plugin with no network, device or process, written next to the application that composes it.
- Look in `plugins/*` and in [primitives](../../../../docs/primitives.md#host-plugin) for a plugin that already covers the concern.
- A plugin imports the framework and the plugins it requires. It never imports `apps/*` or `examples/*`.

## Steps

1. Create `plugins/<name>` with a `package.json` named `@agent-native/<name>`.
2. Start its README with that name as the first line; `bun run check:readmes` enforces it.
3. Declare the browser-safe `plugin-manifest` entrypoint with `definePluginManifest`. List its modules and the settings it claims. Put its [requirement declarations](../../../../docs/glossary.md#requirement-declaration) in `components`: destinations, exchange folders, devices and child processes. Startup refuses a setting that no composed plugin claims.
4. Declare the server `plugin` entrypoint with `defineHostPlugin`: `state.create` for its own slice, its handlers, and an authorization port over its own resource types only.
5. List the plugins it needs in `requires`.
6. Implement the lifecycle hooks it needs: `open`, `ready`, `start` and `close`. [Lifecycle](../../../../docs/architecture.md#lifecycle) says when each runs; `open` may refuse startup.
7. Reach the network, ingress, identity, processes, exchange folders and the [audit log](../../../../docs/glossary.md#audit-log) only through `HostPorts`. Never reach them through another plugin's imports.
8. Write from a loop or job only through the plugin's own commands, as a caller under a [delegated grant](../../../../docs/glossary.md#grant). Never write into application state.
9. Add CLI verbs as `PluginCommand` entries in `commands`. They run before any workspace opens.
10. Add a step to `state.migrations` when the slice shape changes.
11. Declare the browser `plugin-screens` entrypoint with `definePluginScreens`, its routes and navigation. The `build-screens` skill (`packages/frame/skills/build-screens/SKILL.md`) covers screens.
12. For native screens and Expo modules, follow the `extend-mobile-host` skill (`packages/mobile/skills/extend-mobile-host/SKILL.md`).
13. Compose the plugin in an application's `manifest.ts`, `application.ts` and `screens.tsx`, after the plugins it requires.
14. Write the README sections a package README has: Layer, Primitives, Entrypoints, Trust boundary, Dependencies, Tests and Skills. State what the plugin trusts and how it fails.
15. Add the plugin's entry to `docs/primitives.md` when it is a new building block.

## Checks

```sh
bun test plugins/<name>
bun run check:boundaries
bun run generate
```

Test the plugin through a fixture application in its own `test/`, never through an example. The tests cover:

- startup refusal for bad settings;
- the port refusing when no plugin provides it;
- a [behavioral scenario](../../../../docs/glossary.md#behavioral-scenario) through `directDriver`.

Then follow the `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`).

## References

- [Architecture](../../../../docs/architecture.md#host-plugins)
- [Notes host plugin sample](../../../../samples/notes-host-plugin/README.md)

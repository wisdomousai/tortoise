---
name: write-host-plugin
description: Write a host plugin in plugins/<name> for a cross-cutting concern (site policy, network, audit, compliance, notifications, a third-party integration) that several applications compose. Use when behavior is not one application's domain but needs its own state slice, policy, settings, lifecycle hooks, CLI verbs, screens or a kernel port. plugins/webhook is the template.
---

# Write a host plugin

A host plugin adds modules, a state slice, a policy, settings, lifecycle hooks and ports to the host. An application lists it in its three entrypoints, so generated artifacts follow from the application alone. `plugins/webhook` is written the way a third party would write one, and its README walks through every part. [Architecture](../../../../docs/architecture.md#host-plugins) describes the lifecycle.

## Before writing

- Decide whether this is a plugin at all. Domain behavior for one application is a capability in that application (the `add-capability` skill, `packages/runtime/skills/add-capability/SKILL.md`). Generic host or frame behavior that every application needs goes in the framework packages.
- Look at the existing plugins in `plugins/*` and at [primitives](../../../../docs/primitives.md#host-plugin) for one that already covers the concern.
- A plugin imports the framework and the plugins it requires. It never imports `apps/*` or `examples/*`.

## Steps

1. Create `plugins/<name>` with a `package.json` named `@agent-native/<name>` and a README whose first line is that name (`bun run check:readmes` enforces it).
2. **`plugin-manifest`** (browser-safe): `definePluginManifest` with its modules, requirement components (network destinations, exchange folders, devices, processes) and the settings it claims. A setting no composed plugin claims refuses startup.
3. **`plugin`** (server): `defineHostPlugin` with `state.create` for its own slice, handlers, and an authorization port over its own resource types only. List the plugins it needs in `requires`.
   - `open` runs before storage and may refuse startup. `ready` runs before the first request. `start` runs once the host listens, with a delegated grant. `close` runs in reverse order.
   - Reach the network, ingress, identity, processes, exchange folders and the audit log only through `HostPorts`, never through another plugin's imports.
   - A loop or job writes only through the plugin's own commands, as a delegated caller, never into application state.
   - CLI verbs are `PluginCommand` entries in `commands`, run before any workspace opens.
   - A changed slice shape gets a step in `state.migrations`.
4. **`plugin-screens`** (browser): `definePluginScreens` with routes and navigation (the `build-screens` skill, `packages/frame/skills/build-screens/SKILL.md`). Native screens and Expo modules are covered by the `extend-mobile-host` skill (`packages/mobile/skills/extend-mobile-host/SKILL.md`).
5. Compose it in an application's `manifest.ts`, `application.ts` and `screens.tsx`, after the plugins it requires.
6. Write the README sections the other plugins have: Primitives, Entrypoints, Trust boundary, Dependencies, Tests. State what the plugin trusts and how it fails.
7. When the plugin is a new building block, add its entry to `docs/primitives.md`.

## Checks

```sh
bun test plugins/<name>
bun run check:boundaries
bun run generate
```

Test it through a fixture application inside the plugin's own `test/`, never through an example. Include startup refusal for bad settings, the port refusing when no plugin provides it, and a behavioral scenario through the direct driver. Then follow the `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`).

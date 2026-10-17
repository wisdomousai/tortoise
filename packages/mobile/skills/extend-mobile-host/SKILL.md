---
name: extend-mobile-host
description: Run an agent-native application on Android or iOS, or extend what it can do there. Use when an application should target mobile, when writing a host plugin with Kotlin or Swift code (an Expo module and config plugin), when an application needs its own Expo config plugin (camera, permissions), when writing native screens or native registry components, when pairing phones and tablets with a hub (plugins/device-link, plugins/hub-link), or when device management should supply settings (plugins/managed-config). Covers packages/mobile, packages/frame-native, apps/mobile and examples/asset-survey-field.
---

# Extend the mobile host

The Expo app in `apps/mobile` runs one application's authority on the device, with the same kernel and runtime as the desktop host and its own workspace. The application, its plugins and its native screens come from `app.config.json` through a generated entry, so the starter names no content. [Mobile host](../../../../docs/mobile.md) describes the modes, pairing and the trust boundary; `examples/asset-survey-field` is the worked reference for a field app paired with a hub.

## Before writing

- Code that runs on the device is portable: no `node:*` or `bun:*` imports and no Node or Bun globals. `bun run test:portable` runs the suites with the Web globals Hermes lacks removed, and `bun run check:boundaries` enforces the imports.
- The device has no egress guard, no listener and no child processes. The network port of the plugin that provides it is the only network path; `plugins/hub-link` reaches only the paired origin.
- Each side owns its workspace. A phone hands records to the hub through the outbox, and the hub decides on each one again as `device:<id>`. There is no multi-master synchronization.

## Steps

1. **Target mobile.** List `mobile` in the manifest's targets and set `targets.mobile.application` in `app.config.json` (`AGENT_NATIVE_MOBILE_APPLICATION` for one build). Add a `screens-native` entrypoint with `defineNativeScreens` from `@agent-native/frame-native/screens`; screens read the session with `useSession()`.
2. **Native screens and components.** Build from the `agent-native-native` registry in `packages/frame-native` (`hold-button`, `status-pill`, `list-row`). After changing a registry item, run `bun run build:registry:native`. A plugin contributes screens with `definePluginNativeScreens`.
3. **A native plugin.** Follow "Writing a native plugin" in the [mobile package README](../../README.md#writing-a-native-plugin): an Expo module next to `src/`, an optional `app.plugin.js` config plugin, `platforms` and `native: { module, expoPlugin? }` in `plugin-manifest`, `pluginNativeModule(manifest)` in `open`, logic in a module that takes the native module as a parameter so Bun tests use a fake, and Expo imports under `src/expo/`, which `tsconfig.native.json` checks. `plugins/intent-scanner` and `plugins/managed-config` are the references.
4. **The application's own config plugins.** An application that needs a build-time permission or resource lists `expoPlugins` with options in its manifest, as `examples/asset-survey-field/manifest.ts` does for `expo-camera`.
5. **Pairing.** Compose `plugins/device-link` on the hub (set `device-link-sync-operations` or pass `syncOperations` to `createDeviceLinkPlugin`) and `plugins/hub-link` on the device. The device names its outbox target `hub` and reaches it through `createPeerPort` in `packages/integration`; the hub's feed comes back through inbound sync.
6. **Device management.** Compose `plugins/managed-config` so MDM values (`hub-url`, `enrollment-code`) become settings, and a managed device pairs on first start.
7. **OS registrations.** Links, shares, intents, shortcuts and notifications come from the application's OS declarations; see the `add-os-integration` skill (`packages/shell/skills/add-os-integration/SKILL.md`).

## Build

```sh
bun run mobile:prepare        # writes the generated entry, native plugin list and OS registrations
bun run mobile:prebuild       # expo prebuild with every config plugin; rerun after adding or removing a native plugin
bun run dev:mobile            # Metro for a development build on a device or emulator
```

An emulator reaches a development hub on loopback through `adb reverse`. A LAN hub needs a site policy whose profile allows listening with TLS and a device that trusts the site CA.

## Checks

```sh
bun run typecheck             # includes tsconfig.native.json
bun run test:portable
bun test packages/mobile apps/mobile plugins/<plugin>
bun test plugins/device-link examples/asset-survey-field
bun run check:mobile-bundle   # Metro bundle of the starter's fixture; not part of bun run check
```

Bun tests run the mobile authority on Bun's SQLite and files with fake device bindings. Kotlin and Swift compile only in a native build, and device, emulator and simulator runs are on demand. Record each such run in the [implementation status](../../../../docs/implementation-status.md#mobile), separately from the Bun tests.

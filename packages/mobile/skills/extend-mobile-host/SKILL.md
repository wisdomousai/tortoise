---
name: extend-mobile-host
description: Run an agent-native application on Android or iOS, or extend what it can do there. Use when an application should target mobile, when writing a host plugin with Kotlin or Swift code (an Expo module and config plugin), when an application needs its own Expo config plugin (camera, permissions), when writing native screens or native registry components, when pairing phones and tablets with a hub (plugins/device-link, plugins/hub-link), or when device management should supply settings (plugins/managed-config). Covers packages/mobile, packages/frame-native, apps/mobile and showcase/examples/asset-survey-field.
---

# Extend the mobile host

The Expo project in `apps/mobile` runs one [application](../../../../docs/glossary.md#application)'s [instance](../../../../docs/glossary.md#instance) on the device. It uses the same [kernel](../../../../docs/glossary.md#composition) and runtime as the desktop host and has its own [workspace](../../../../docs/glossary.md#workspace). The application, its plugins and its native screens come from `app.config.json` through a generated entry, so the starter names no content.

## Before writing

- Keep code that runs on the device portable: no `node:*` or `bun:*` imports and no Node or Bun globals. `bun run test:portable` runs the suites with the Web globals Hermes lacks removed, and `bun run check:boundaries` enforces the imports.
- The device has no [egress guard](../../../../docs/glossary.md#egress-guard), no listener and no child processes. The network port of the plugin that provides it is the only network path, and `plugins/hub-link` reaches only the paired origin.
- Each side owns its workspace. A phone hands records to the hub through the [outbox](../../../../docs/glossary.md#outbox), and the hub decides on each one again as `device:<id>`. There is no multi-master synchronization.

## Steps

1. List `mobile` in the manifest's targets.
2. Set `targets.mobile.application` in `app.config.json`, or `AGENT_NATIVE_MOBILE_APPLICATION` for one build.
3. Add a `screens-native` entrypoint with `defineNativeScreens` from `@agent-native/frame-native/screens`. Screens read the session with `useSession()`.
4. Build native screens from the `agent-native-native` [UI registry](../../../../docs/glossary.md#ui-registry) in `packages/frame-native`, such as `hold-button`, `status-pill` and `list-row`. A phone that takes assignments shows the worklist kit's `<namespace>.assignment.list` with `worklist-list`, and its target status and `<namespace>.report.list` with `worklist-sync`.
5. Run `bun run build:registry:native` after changing a registry item.
6. Contribute a plugin's native screens with `definePluginNativeScreens` and a feature's with `defineFeatureNativeScreens`. Pass the application's `manifest` to `defineNativeScreens`, which checks unit screens against it.
7. For a native plugin, follow "Writing a native plugin" in the [mobile package README](../../README.md#writing-a-native-plugin). In short:
   - put an Expo module next to `src/`, with an optional `app.plugin.js` config plugin;
   - set `platforms` and `native: { module, expoPlugin? }` in `plugin-manifest`;
   - call `pluginNativeModule(manifest)` in `open`;
   - keep the logic in a module that takes the native module as a parameter, so Bun tests use a fake;
   - keep Expo imports under `src/expo/`, which `tsconfig.native.json` checks.
8. For a build-time permission or resource of the application's own, list `expoPlugins` with options in its manifest, as `showcase/examples/asset-survey-field/manifest.ts` does for `expo-camera`.
9. Compose `plugins/device-link` on the hub. Set `device-link-sync-operations`, or pass `syncOperations` to `createDeviceLinkPlugin`.
10. Compose `plugins/hub-link` on the device. The device names its outbox [target](../../../../docs/glossary.md#target) `hub` and reaches it through `createPeerPort` in `packages/integration`. The hub's feed comes back through [inbound sync](../../../../docs/glossary.md#inbound-sync).
11. Compose `plugins/managed-config` so that MDM values such as `hub-url` and `enrollment-code` become settings. A managed device then pairs on first start.
12. Declare links, shares, intents, shortcuts and notifications in the application's OS declarations. The `add-os-integration` skill (`packages/shell/skills/add-os-integration/SKILL.md`) has the steps. A native screen asks for a declared action with `useOsAction` from `@agent-native/frame-native/os-actions`.
13. Build with the commands below.

    ```sh
    bun run mobile:prepare        # writes the generated entry, native plugin list and OS registrations
    bun run mobile:prebuild       # expo prebuild with every config plugin; rerun after adding or removing a native plugin
    bun run dev:mobile            # Metro for a development build on a device or emulator
    ```

14. Reach a development hub from an emulator on loopback through `adb reverse`. A hub on the LAN needs a deployment policy whose profile allows listening with TLS, and a device that trusts the site CA.

## Checks

```sh
bun run typecheck             # includes tsconfig.native.json
bun run test:portable
bun test packages/mobile apps/mobile plugins/<plugin>
bun test plugins/device-link showcase/examples/asset-survey-field
bun run check:mobile-bundle   # Metro bundle of the starter's fixture; not part of bun run check
```

Bun tests run the mobile instance on Bun's SQLite and files with fake device bindings. Kotlin and Swift compile only in a native build, and device, emulator and simulator runs are on demand. Record each such run in the [implementation status](../../../../docs/implementation-status.md#mobile), separately from the Bun tests.

## References

- [Mobile host](../../../../docs/mobile.md)
- [`showcase/examples/asset-survey-field`](../../../../showcase/examples/asset-survey-field/README.md)
- [`plugins/intent-scanner`](../../../../plugins/intent-scanner/README.md)
- [`plugins/managed-config`](../../../../plugins/managed-config/README.md)

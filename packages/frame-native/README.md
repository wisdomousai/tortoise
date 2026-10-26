# @agent-native/frame-native

The domain-neutral React Native frame around one application's native [screens](../../docs/glossary.md#screen), for Android and iOS. It supplies navigation, the [session](../../docs/glossary.md#session) context and live invalidation, and fills them from the configured application's `screens-native` entrypoint. The package also ships glove-sized components as a shadcn registry, styled with Tailwind classes through Uniwind.

## Layer

Framework (`packages/*`). The mobile starter in `apps/mobile` renders `NativeFrame`. Content imports `defineNativeScreens`, `useSession` and the components. The frame trusts the starter to pass in the screens and the transport.

## Primitives

- [Native frame](../../docs/primitives.md#native-frame): `NativeFrame`, `useNativeScreens`, `useFrameNavigation`, `SessionProvider`, `useSession`, `NativeSession`, `RAIL_WIDTH`. The session context holds the transport, the typed client, live bindings and the query cache.
- [Application](../../docs/primitives.md#application): `defineNativeScreens`, `nativeScreenForCapability` and the `NativeApplicationScreens`, `NativeScreenRoute` and `NativeNavigationItem` types. Together they form the native screens entrypoint of an application that targets mobile.
- [OS handler](../../docs/primitives.md#os-handler): `OsDeliveries`, `OsDeliverySource`, `applyOsDelivery`, `usePreparedInput`, `PreparedInput`, `useShownProvenance`, `OsProvenanceNotice`, `ShownProvenance`, and `NativeApplicationScreens.resources`, the screen that shows each selectable resource kind.
- [Feature](../../docs/primitives.md#feature): `defineFeatureNativeScreens`, `FeatureNativeScreens`. `defineNativeScreens({ manifest, features })` merges a feature's screens, tabs and capability screens before its checks.
- [Host plugin](../../docs/primitives.md#host-plugin): `definePluginNativeScreens`, `PluginNativeScreens`, the same shape. `defineNativeScreens({ manifest, plugins })` merges plugin screens after feature screens.
- [UI registry](../../docs/primitives.md#ui-registry): the `agent-native-native` registry in [`registry.json`](registry.json): `native-theme`, `hold-button` with `useHold`, `status-pill` with `StatusPill` and `Signal`, `list-row` with `ListRow`, `worklist-list` with `WorklistList`, and `worklist-sync` with `WorklistSync` and `SyncPill`.

## Entrypoints

| Import                                      | Runs in      | Contents                                                                                         |
| ------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| `@agent-native/frame-native/screens`        | any host     | `defineNativeScreens`, `nativeScreenForCapability` and the screen types. No React Native import. |
| `@agent-native/frame-native/feature-screens` | any host    | `defineFeatureNativeScreens`, `FeatureNativeScreens`.                                            |
| `@agent-native/frame-native/plugin-screens` | any host     | `definePluginNativeScreens`, `PluginNativeScreens`.                                              |
| `@agent-native/frame-native/frame`          | React Native | `NativeFrame`, `useNativeScreens`, `useFrameNavigation`, `RAIL_WIDTH`.                           |
| `@agent-native/frame-native/session`        | React Native | `SessionProvider`, `useSession`, `NativeSession`.                                                |
| `@agent-native/frame-native/os-deliveries`  | React Native | `OsDeliveries`, `applyOsDelivery`, `usePreparedInput`, `useShownProvenance`.                     |
| `@agent-native/frame-native/os-provenance`  | React Native | `OsProvenanceNotice`, `ShownProvenance`.                                                         |
| `@agent-native/frame-native/components/*`   | React Native | Registry components: `hold-button`, `status-pill`, `list-row`, `worklist-list`, `worklist-sync`. |
| `@agent-native/frame-native/theme.css`      | build time   | The native theme: signal colors for light and dark appearance, glove target and text sizes.      |

### Navigation and session

A screen names itself by `path`, such as `/captures`, the way a web route does. Navigation and capability targets therefore read the same in both frames. Navigation items become tabs. The tabs sit at the bottom on phones and form a rail on the left from `RAIL_WIDTH` (768 points) up, which covers tablets.

Every other screen is pushed on a stack above the tabs and receives its parameters as React Navigation route params. `useFrameNavigation().open(path, params)` opens either kind. `openCapability(id)` opens the screen bound to a [capability](../../docs/glossary.md#capability).

Screens read the session with `useSession()`. Web screens import it from `@/lib/session`, but on the device the transport exists only after the [instance](../../docs/glossary.md#instance) opens. `NativeFrame` starts a new session with an empty query cache whenever it gets a new transport.

### Theme and components

`scripts/build-operator-registry.ts` generates `theme.css` from the operator registry's manifest, so a signal has the same color on a phone and at a station. Uniwind has no attribute selectors, so the native theme fixes the glove density instead of switching it. The starter's own palette (background, foreground, primary, muted, border) is in `apps/mobile/global.css`.

The components import only `react`, `react-native`, `uniwind` and `lucide-react-native`. They never import an `@/` path. `worklist-list` and `worklist-sync` import `list-row` and `status-pill` by relative path and list them in `registryDependencies`, so shadcn adds them to the same folder; every other component is one file. `useHold` repeats the operator registry's `usePressAndHold` rules on React Native press events. Lifting early or sliding off aborts, and the finger must lift before the button can confirm again. Screen readers activate the button directly.

Build the registry into `dist/registry/native`:

```sh
bun run build:registry:native
```

## Trust boundary

The frame imports no application and no plugin. The starter passes the screens in from its generated entry. The frame does not open the instance, choose the [principal](../../docs/glossary.md#principal) or hold credentials. It renders whatever the transport it receives allows.

The starter may also pass the instance's [plugin services](../../docs/glossary.md#plugin-service), which screens read from `useSession().services`. A plugin's screen uses only its own plugin's service, such as pairing. That service still writes through commands.

`defineNativeScreens` checks the application's, its features' and its plugins' screens together. It fails at definition time on:

- a duplicate path;
- a tab declared twice;
- a home that is not a tab;
- a navigation or capability target that no screen declares;
- feature or plugin screens without the application's `manifest`, for a unit the manifest does not compose, or out of the manifest's order;
- a unit capability screen whose prefix is outside the unit's operation namespace.

With an `os` source, `NativeFrame` applies each OS delivery once navigation is ready. It opens one of these:

- the screen that `screens.resources` names for a resource;
- a declared screen;
- the screen bound to a prepared command, with the prefill held for `usePreparedInput`.

A target no screen declares opens nothing. The provenance notice shows where the delivery came from, as text, until the person dismisses it. Nothing submits on its own: a prefill is committed only when the person confirms the form.

`check:boundaries` treats `src/` as portable: no Node or Bun import or global. Only `tsconfig.native.json` type-checks the React Native files. The root project checks `screens.ts`, `feature-screens.ts`, `plugin-screens.ts` and `os-deliveries.tsx`.

## Dependencies

Framework: `@agent-native/client`, `@agent-native/react` for its `query` module, `@agent-native/contracts` for types and `@agent-native/shell` for `provenance`. External: `@react-navigation/native`, `@react-navigation/bottom-tabs`, `@react-navigation/native-stack`, `@tanstack/react-query`, `uniwind`, `lucide-react-native`, with `react`, `react-native` and `react-native-safe-area-context` as peer dependencies.

## Tests

```sh
bun test packages/frame-native
bun run typecheck
bun run check:mobile-bundle
```

- `test/os-deliveries.test.ts`: a delivery opens a declared screen, a resource's screen or a prepared command's form, and a target no screen declares is refused.
- `test/screens.test.ts`: feature and plugin merging, the longest-prefix capability lookup, the manifest checks and each definition-time refusal.

The frame and the components have no render tests. `typecheck` checks them against React Native's and Uniwind's types. `check:mobile-bundle` bundles them with the starter's fixture application through Metro and Uniwind. They have not run on a device.

## Skills

- [extend-mobile-host](../mobile/skills/extend-mobile-host/SKILL.md): native plugins, native screens and pairing.

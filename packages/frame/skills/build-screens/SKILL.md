---
name: build-screens
description: Build or change the web screens of an agent-native application or host plugin. Use when adding a route, list or record screen, form, capture or station screen, navigation item or capability screen; when pulling or changing an item of the agent-native or operator shadcn registry; or when replacing a frame file in the starter. Covers examples/<app>/screens.tsx, examples/<app>/ui, packages/frame, packages/react, packages/operator-ui and apps/web.
---

# Build screens

Screens are the browser half of an application. They read through live queries and write only through catalog commands, so a person and an agent reach the same behavior. The [frame README](../../README.md) describes the shell, routes, layouts and registry; [primitives](../../../../docs/primitives.md#ui-registry) lists the registry items. `examples/project-tasks/screens.tsx` is the smallest worked `screens` entrypoint.

## Before writing

- Start from a registry item before writing a component. `collection-screen` builds list and record screens from a collection's generated capabilities, `capability-form` renders any command, and `live-data-table` pages after the authority scopes rows. They live in `packages/frame/src/components`.
- For gloved or high-frequency input, use the `operator` registry (`packages/operator-ui`) and read [point-of-work input](../../../../docs/point-of-work-input.md). `examples/quality-inspection/ui/capture-station.tsx` is the pattern for repeated entry; `examples/line-station/ui/station.tsx` composes a full station screen.
- Each command a screen issues must be declared with a matching `ui.binding` on its capability (the `add-capability` skill, `packages/runtime/skills/add-capability/SKILL.md`).

## Steps

1. **Declare routes** in the application's `screens.tsx` with `defineScreens`: routes, navigation, the screen for each capability, and `resources` for screens that open an OS-delivered resource. A station screen uses `layout: 'full'`; a route may declare `compact` for phone and portrait-tablet widths.
2. **A plugin's screens** come from `definePluginScreens` in its `plugin-screens` entrypoint and are merged with `defineScreens({ plugins })`. `defineScreens` fails on duplicate routes and on targets no route declares.
3. **Write commands** with `useCapabilityForm` from `@agent-native/react/form`. It keeps one idempotency key until the command commits, so a double tap or a scanner's double Enter records once. Do not mint keys per click.
4. **Read data** with `useLiveQuery`. It refetches only queries whose dependencies changed. Never filter or page client-side over a partial set.
5. **Capture input** with `useScannerInput`, `useCaptureTiming` and `useCaptureLoop` from `@agent-native/react/capture`, so capture time is measured.
6. **Change a registry item** in its source. For the operator registry, edit `packages/operator-ui/registry.manifest.ts` and run `bun run build:registry:operator`; never hand-edit the generated `registry.json` or `src/styles/operator.css`. Rebuild the frame registry with `bun run build:registry`.
7. **Framework operations have registry screens**: `proposal-review` for `proposalOperations` and `reconciliation-review` for `reconciliationOperations`. Wrap one in an application screen that passes the operations and a `describe` label (`examples/receiving/ui/reconcile.tsx`).
8. **Change the starter's look** in `apps/web`: a file at the same `src/` path as a frame file replaces it, and stock primitives are added with `shadcn add`. Keep domain screens in the application, never in the starter.

The authority's CSP rejects inline scripts and injected styles, so use components that render native elements (`ui/native-dialog`) instead of ones that inject styles at runtime. Browser files must not import server modules.

Native screens use `defineNativeScreens` from `packages/frame-native`; see the `extend-mobile-host` skill (`packages/mobile/skills/extend-mobile-host/SKILL.md`).

## Checks

- A UI-binding test with `unboundOperations` from `@agent-native/testing/ui-bindings` proves every operation that claims a binding is referenced by a screen (`examples/project-tasks/test/ui-bindings.test.ts`). Add plugin screen directories to its scan.
- A Playwright spec in `examples/<app>/e2e/` proves the screen renders and commits. A static scan does not.

```sh
bun run check:boundaries
bun run build:web:examples
bun run check:registry:operator
bunx playwright test examples/<app>/e2e
```

Report browser runs separately from unit tests; a successful build is not a browser interaction.

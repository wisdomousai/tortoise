---
name: build-screens
description: Build or change the web screens of an agent-native application or host plugin. Use when adding a route, list or record screen, form, capture or station screen, navigation item or capability screen; when pulling or changing an item of the agent-native or operator shadcn registry; or when replacing a frame file in the starter. Covers examples/<app>/screens.tsx, examples/<app>/ui, packages/frame, packages/react, packages/operator-ui and apps/web.
---

# Build screens

[Screens](../../../../docs/glossary.md#screen) are the browser half of an application. They read through [live queries](../../../../docs/glossary.md#live-query) and write only through catalog commands, so a person and an agent reach the same behavior. The [frame README](../../README.md) describes the [web frame](../../../../docs/glossary.md#web-frame), routes, layouts and registry. [Primitives](../../../../docs/primitives.md#ui-registry) lists the registry items. `examples/project-tasks/screens.tsx` is the smallest worked `screens` entrypoint.

## Before writing

- Start from a [UI registry](../../../../docs/glossary.md#ui-registry) item before writing a component. The items live in `packages/frame/src/components`:
  - `collection-screen` builds list and record screens from a collection's generated capabilities;
  - `capability-form` renders any command;
  - `live-data-table` pages after the instance scopes rows.
- For gloved or high-frequency input, use the `operator` registry (`packages/operator-ui`) and read [point-of-work input](../../../../docs/point-of-work-input.md).
- `examples/quality-inspection/ui/capture-station.tsx` is the pattern for repeated entry. `examples/line-station/ui/station.tsx` composes a full station's screen.
- Each command a screen issues needs a matching `ui.binding` on its capability, its [UI binding](../../../../docs/glossary.md#ui-binding). The `add-capability` skill (`packages/runtime/skills/add-capability/SKILL.md`) covers it.
- The instance's content security policy rejects inline scripts and injected styles. Use components that render native elements, such as `ui/native-dialog`, instead of ones that inject styles at runtime.
- Browser files must not import server modules.

## Steps

1. Declare the routes in the application's `screens.tsx` with `defineScreens`: routes, navigation, the screen for each capability, and `resources` for screens that open a resource the OS delivers.
2. Give a station's screen `layout: 'full'`. Declare `compact` on a route for phone and portrait-tablet widths.
3. Declare a plugin's screens with `definePluginScreens` in its `plugin-screens` entrypoint.
4. Merge plugin screens with `defineScreens({ plugins })`. It fails on duplicate routes and on targets no route declares.
5. Write commands with `useCapabilityForm` from `@agent-native/react/form`. It keeps one [idempotency key](../../../../docs/glossary.md#idempotency-key) until the command commits, so a double tap or a scanner's double Enter records once. Do not mint keys per click.
6. Read data with `useLiveQuery`. It refetches only the queries whose dependencies changed. Never filter or page client-side over a partial set.
7. Capture input with `useScannerInput`, `useCaptureTiming` and `useCaptureLoop` from `@agent-native/react/capture`, so capture time is measured.
8. Change a registry item in its source. For the operator registry, edit `packages/operator-ui/registry.manifest.ts` and run `bun run build:registry:operator`.
9. Never hand-edit the generated `registry.json` or `src/styles/operator.css`.
10. Rebuild the frame registry with `bun run build:registry`.
11. For framework capabilities, wrap the registry screen in an application screen that passes the capabilities and a `describe` label, as `examples/receiving/ui/reconcile.tsx` does. `approval-review` takes `approvalOperations`, and `reconciliation-review` takes `reconciliationOperations`.
12. Change the starter's look in `apps/web`. A file at the same `src/` path as a frame file replaces it.
13. Add stock primitives to `apps/web` with `shadcn add`. Keep domain screens in the application, never in the starter.
14. For native screens, use `defineNativeScreens` from `packages/frame-native` and follow the `extend-mobile-host` skill (`packages/mobile/skills/extend-mobile-host/SKILL.md`).

## Checks

1. Add a UI-binding test with `unboundOperations` from `@agent-native/testing/ui-bindings`, as in `examples/project-tasks/test/ui-bindings.test.ts`. It proves a screen references every capability that claims a binding.
2. Add plugin screen directories to that test's scan.
3. Add a Playwright spec in `examples/<app>/e2e/` that proves the screen renders and commits. A static scan does not prove it.
4. Run the checks:

   ```sh
   bun run check:boundaries
   bun run build:web:examples
   bun run check:registry:operator
   bunx playwright test examples/<app>/e2e
   ```

5. Report browser runs separately from unit tests. A successful build is not a browser interaction.
